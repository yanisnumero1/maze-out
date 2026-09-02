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

function bars(items: any[], valueOf: (item: any) => number, label: (item: any, index: number) => string) {
  const maximum = Math.max(0, ...items.map(valueOf));
  if (!items.length) return '<p style="color:#a1a1aa">Aucune donnée.</p>';
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">${items.map((item, index) => {
    const value = valueOf(item);
    const percent = maximum ? Math.max(4, Math.round((value / maximum) * 100)) : 0;
    return `<tr><td style="padding:7px 0;color:#f4f4f5"><b>${escape(label(item, index))}</b></td></tr><tr><td style="padding:0 0 12px"><div style="height:8px;background:#27272a;border-radius:999px"><div style="height:8px;width:${percent}%;background:#d946ef;border-radius:999px"></div></div></td></tr>`;
  }).join('')}</table>`;
}

function reportEmail(snapshot: Record<string, any>) {
  const night = snapshot.night_session ?? {};
  const summary = snapshot.summary ?? {};
  const analytics = snapshot.analytics ?? {};
  const performance = snapshot.performance ?? {};
  const date = night.started_at ? formatDate(night.started_at) : '—';
  const duration = night.started_at && night.ended_at ? `${formatTime(night.started_at)} → ${formatTime(night.ended_at)}` : '—';
  const zonesData = performance.zones ?? snapshot.zones ?? [];
  const waitersData = performance.head_waiters ?? snapshot.head_waiters ?? [];
  const topTables = snapshot.top_tables ?? [];
  const promotersData = snapshot.promoters_ranked ?? snapshot.promoters ?? [];
  const businessReferrers = snapshot.business_referrers_ranked ?? [];
  const cdrVisitNotes = snapshot.cdr_visit_notes ?? [];
  const salesDetails = Array.isArray(snapshot.sales_details) ? snapshot.sales_details : [];
  const zones = bars(zonesData, (zone) => Number(zone.total_sales ?? 0), (zone) => `${zone.name} — ${zone.total_sales ?? 0} ventes · ${zone.people_welcomed ?? 0} personnes`);
  const waiters = bars(waitersData, (waiter) => Number(waiter.total_sales ?? 0), (waiter, index) => `${index < 3 ? `#${index + 1} · ` : ''}${waiter.name} — ${waiter.total_sales ?? 0} ventes · ${waiter.people_welcomed ?? 0} personnes`);
  const tables = bars(topTables, (table) => Number(table.total_sales ?? 0), (table) => `Table ${table.table_number} — ${table.total_sales} ventes · ${table.people_welcomed} personnes`);
  const promoters = rows(promotersData, (promoter) => `${escape(promoter.name)} — ${escape(promoter.people_welcomed)} personnes`);
  const referrers = rows(businessReferrers, (referrer) => `${escape(referrer.name)} — ${escape(referrer.total_sales)} vente${Number(referrer.total_sales) !== 1 ? 's' : ''} · ${escape(referrer.people_welcomed)} personnes`);
  const cdrNotes = rows(cdrVisitNotes, (visit) => `Table ${escape(visit.table_number)} · Vente #${escape(visit.sale_number ?? '—')}<br><small>CDR : ${escape(visit.head_waiter_name ?? '—')} · ${escape(visit.people_welcomed)} personnes${visit.business_referrer ? ` · Apporteur : ${escape(visit.business_referrer)}` : ''}</small>${visit.cdr_comment ? `<br>${escape(visit.cdr_comment)}` : ''}`);
  const sales = salesDetails.length ? `<div>${salesDetails.map((sale: Record<string, any>) => {
    const origin = sale.origin_table_number ?? '—';
    const final = sale.final_table_number ?? origin;
    const tableLabel = String(final) !== String(origin) ? `Table ${origin} → Table ${final}` : `Table ${origin}`;
    const referrer = sale.business_referrer_name ? `Apporteur : ${escape(sale.business_referrer_name)}` : sale.proposed_business_referrer_name ? `Proposé : ${escape(sale.proposed_business_referrer_name)}` : 'Apporteur : —';
    return `<section style="margin:0 0 12px;padding:12px;background:#18181b;border:1px solid #3f3f46;border-radius:10px"><b style="color:#fff">${escape(tableLabel)} · Vente #${escape(sale.sale_number ?? '—')}</b><p style="margin:8px 0 0;color:#d4d4d8;font-size:14px">CDR : ${escape(sale.final_head_waiter_name ?? '—')}<br>Réservation : ${escape(sale.reservation_name ?? '—')}<br>Conso : ${escape(sale.consumption ?? '—')}<br>Commentaire : ${escape(sale.sale_comment ?? '—')}<br>Note CDR : ${escape(sale.cdr_comment ?? '—')}<br>${referrer}</p></section>`;
  }).join('')}</div>` : '';
  const notes = rows(snapshot.floor_notes ?? [], (note) => `${escape(note.created_at ? formatTime(note.created_at) : '')} — ${escape(note.content)}`);
  const activity = rows((snapshot.recent_activity ?? []).slice(0, 15), (item) => {
    const actor = item.actor_name ? `${item.actor_name}${item.actor_role ? ` · ${item.actor_role}` : ''}` : 'Auteur inconnu';
    return `${escape(item.created_at ? formatTime(item.created_at) : '')} — ${escape(item.title ?? 'Activité')}${item.detail ? `<br><span>${escape(item.detail)}</span>` : ''}<br><small>${escape(actor)}</small>`;
  });
  const topWaiter = waitersData[0];
  const topZone = zonesData[0];
  const topTable = topTables[0];
  const topPromoter = promotersData[0];
  const highlights = [
    topWaiter && `CDR le plus actif : ${topWaiter.name} avec ${topWaiter.total_sales ?? 0} ventes.`,
    topZone && `Carré le plus actif : ${topZone.name} avec ${topZone.total_sales ?? 0} ventes.`,
    topTable && `Table la plus sollicitée : Table ${topTable.table_number} avec ${topTable.total_sales} ventes.`,
    topPromoter && `Promoteur n°1 : ${topPromoter.name} avec ${topPromoter.people_welcomed} personnes.`,
  ].filter(Boolean);
  return {
    subject: `Compte rendu de soirée — BRIDGE — ${date}`,
    html: `<!doctype html><html lang="fr"><body style="margin:0;background:#09090b;color:#f4f4f5;font-family:Arial,sans-serif"><main style="max-width:640px;margin:auto;padding:24px"><h1 style="margin:0;color:#fff">MAZE-OUT · BRIDGE</h1><p style="color:#d4d4d8">COMPTE RENDU DE SOIRÉE · ${escape(date)} · ${escape(duration)}</p><h2>RÉSUMÉ</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:8px;background:#18181b">${escape(value(summary, 'total_sales'))}<br><small>VENTES</small></td><td style="padding:8px;background:#18181b">${escape(value(summary, 'people_welcomed'))}<br><small>PERSONNES AUX TABLES</small></td></tr><tr><td style="padding:8px;background:#18181b">${escape(value(analytics, 'distinct_tables_sold') ?? value(summary, 'distinct_tables_sold'))}<br><small>TABLES EXPLOITÉES</small></td><td style="padding:8px;background:#18181b">${escape(value(analytics, 'rotation_count'))}<br><small>ROTATIONS</small></td></tr><tr><td style="padding:8px;background:#18181b">${escape(value(analytics, 'transfer_count'))}<br><small>TRANSFERTS</small></td><td style="padding:8px;background:#18181b">${escape(value(summary, 'club_entries'))}<br><small>ENTRÉES CLUB</small></td></tr><tr><td style="padding:8px;background:#18181b">${escape(value(analytics, 'promoter_people'))}<br><small>PROMOTEURS</small></td><td style="padding:8px;background:#18181b">${escape(value(analytics, 'floor_note_count'))}<br><small>NOTES PISTE</small></td></tr></table>${sales ? `<h2>DÉTAIL DES VENTES</h2>${sales}` : ''}<h2>PERFORMANCE CDR</h2>${waiters}<h2>PERFORMANCE PAR CARRÉ</h2>${zones}<h2>TOP TABLES</h2>${tables}<h2>PROMOTEURS</h2>${promoters}<h2>APPORTEURS D’AFFAIRES</h2>${referrers}<h2>NOTES CDR</h2>${cdrNotes}<h2>ENTRÉES CLUB</h2><p><b>${escape(value(summary, 'club_entries'))} entrées</b></p><h2>PISTE</h2>${notes}<h2>POINTS CLÉS</h2>${rows(highlights, (point) => escape(point))}<h2>ACTIVITÉ RÉCENTE</h2>${activity}</main></body></html>`,
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
