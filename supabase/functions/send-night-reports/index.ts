import { createClient } from 'npm:@supabase/supabase-js@2';

type ClaimedDelivery = { delivery_id: string; night_report_id: string; recipient_name: string | null; recipient_email: string; snapshot: Record<string, any> };

const value = (source: Record<string, any>, key: string) => source[key] ?? '—';
const escape = (source: unknown) => String(source ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const formatDate = (value: string) => new Date(value).toLocaleDateString('fr-FR');
const formatTime = (value: string) => new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function secretKey() {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY');
  if (legacy) return legacy;
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  return keys ? JSON.parse(keys).default : undefined;
}

function rows(items: any[], cells: (item: any) => string) {
  return items.length ? `<ul>${items.map((item) => `<li>${cells(item)}</li>`).join('')}</ul>` : '<p>Aucune donnée.</p>';
}

function reportEmail(snapshot: Record<string, any>) {
  const night = snapshot.night_session ?? {};
  const summary = snapshot.summary ?? {};
  const date = night.started_at ? formatDate(night.started_at) : '—';
  const duration = night.started_at && night.ended_at ? `${formatTime(night.started_at)} → ${formatTime(night.ended_at)}` : '—';
  const zones = rows(snapshot.zones ?? [], (zone) => `<b>${escape(zone.name)}</b> — ${escape(zone.tables_sold)} / ${escape(zone.total_tables)} tables, ${escape(zone.total_sales)} ventes, ${escape(zone.people_welcomed)} personnes`);
  const waiters = rows(snapshot.head_waiters ?? [], (waiter) => `<b>${escape(waiter.name)}</b> — ${escape(waiter.tables_sold)} / ${escape(waiter.assigned_tables)} tables, ${escape(waiter.people_welcomed)} personnes`);
  const promoters = rows(snapshot.promoters ?? [], (promoter) => `${escape(promoter.name)} — ${escape(promoter.people_welcomed)} personnes`);
  const notes = rows(snapshot.floor_notes ?? [], (note) => `${escape(note.created_at ? formatTime(note.created_at) : '')} — ${escape(note.content)}`);
  const activity = rows((snapshot.recent_activity ?? []).slice(0, 15), (item) => {
    const actor = item.actor_name ? `${item.actor_name}${item.actor_role ? ` · ${item.actor_role}` : ''}` : 'Auteur inconnu';
    return `${escape(item.created_at ? formatTime(item.created_at) : '')} — ${escape(item.title ?? 'Activité')}${item.detail ? `<br><span>${escape(item.detail)}</span>` : ''}<br><small>${escape(actor)}</small>`;
  });
  return {
    subject: `Compte rendu de soirée — BRIDGE — ${date}`,
    html: `<!doctype html><html lang="fr"><body style="margin:0;background:#09090b;color:#f4f4f5;font-family:Arial,sans-serif"><main style="max-width:640px;margin:auto;padding:24px"><h1 style="margin:0;color:#fff">BRIDGE</h1><p style="color:#d4d4d8">Compte rendu de soirée · ${escape(date)}</p><section><p><b>Début / fin</b> : ${escape(duration)}</p></section><h2>RÉSUMÉ</h2><ul><li>Tables vendues : ${escape(value(summary, 'distinct_tables_sold'))}</li><li>Ventes totales : ${escape(value(summary, 'total_sales'))}</li><li>Personnes accueillies : ${escape(value(summary, 'people_welcomed'))}</li><li>Entrées club : ${escape(value(summary, 'club_entries'))}</li></ul><h2>CARRÉS</h2>${zones}<h2>CDR</h2>${waiters}<h2>PROMOTEURS</h2>${promoters}<h2>PISTE</h2>${notes}<h2>ACTIVITÉ RÉCENTE</h2>${activity}</main></body></html>`,
  };
}

Deno.serve(async (request) => {
  const workerSecret = Deno.env.get('NIGHT_REPORT_WORKER_SECRET');
  if (!workerSecret || request.headers.get('authorization') !== `Bearer ${workerSecret}`) return new Response('Unauthorized', { status: 401 });
  const url = Deno.env.get('SUPABASE_URL');
  const key = secretKey();
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('REPORT_FROM_EMAIL');
  if (!url || !key || !resendKey || !from) return new Response('Worker configuration missing', { status: 500 });
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await db.rpc('claim_night_report_deliveries', { p_limit: 20 });
  if (error) { console.error('[NIGHT_REPORT] Claim failed', error); return Response.json({ error: 'Claim failed' }, { status: 500 }); }
  const deliveries = (data ?? []) as ClaimedDelivery[];
  for (const delivery of deliveries) {
    const email = reportEmail(delivery.snapshot);
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `night-report/${delivery.night_report_id}/${delivery.delivery_id}` },
        body: JSON.stringify({ from, to: [delivery.recipient_email], reply_to: Deno.env.get('REPORT_REPLY_TO') || undefined, subject: email.subject, html: email.html }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.id) throw new Error(payload.message ?? `Resend HTTP ${response.status}`);
      const { error: completionError } = await db.rpc('complete_night_report_delivery', { p_delivery_id: delivery.delivery_id, p_provider_message_id: payload.id, p_error: null });
      if (completionError) console.error('[NIGHT_REPORT] Delivery success was not persisted', completionError);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown email error';
      console.error('[NIGHT_REPORT] Send failed', { deliveryId: delivery.delivery_id, message });
      await db.rpc('complete_night_report_delivery', { p_delivery_id: delivery.delivery_id, p_provider_message_id: null, p_error: message });
    }
  }
  return Response.json({ claimed: deliveries.length });
});
