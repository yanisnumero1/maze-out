import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { liveActivity, liveDashboard, liveDashboardAlerts, liveLoadStatus, liveZoneDashboard, recentArrivalsByZone } from '@/lib/live';
import type { ArrivalDraft, LiveTable, TableVisit, TableVisitTransfer, Zone } from '@/lib/types';

const dashboardSource = readFileSync(resolve(process.cwd(), 'components/live-dashboard.tsx'), 'utf8');
const hostessHubSource = readFileSync(resolve(process.cwd(), 'components/hostess-hub.tsx'), 'utf8');
const zoneA: Zone = { id: 'a', name: 'Carré 1', display_order: 1, active: true, max_capacity: 230 };
const zoneB: Zone = { id: 'b', name: 'Backstage', display_order: 2, active: true, max_capacity: 90 };
const table = (id: string, zone: Zone, present = 0, extras = 0): LiveTable => ({
  id, number: id, display_number: Number(id.replace(/\D/g, '')) || 1, zone_id: zone.id, head_waiter_id: null,
  standard_capacity: 7, status: 'free', position_x: 0, position_y: 0, active: true, zone, head_waiter: null,
  reservation: null, occupancy: present || extras ? { table_id: id, present_people: present, extra_guests: extras, comment: null, arrived_at: null, updated_at: '' } : null,
});
const draft = (id: string, people: number, extras = 0): ArrivalDraft => ({ id, table_id: id, actor_id: 'hostess', night_session_id: 'night', present_people: people, extra_guests: extras, comment: null, status: 'draft', confirmed_sale_number: null, created_at: '', updated_at: '', confirmed_at: null });
const visit = (id: string, tableId: string, arrivedAt: string, endedAt: string | null = null): TableVisit => ({ id, night_session_id: 'night', table_id: tableId, current_table_id: tableId, zone_id: zoneA.id, head_waiter_id: null, present_people: 5, extra_guests: 2, comment: null, arrived_at: arrivedAt, ended_at: endedAt, sale_number: 2, zone: zoneA, head_waiter: null });
const transfer = (id: string, visitId: string, from: string, to: string, createdAt: string): TableVisitTransfer => ({ id, night_session_id: 'night', table_visit_id: visitId, from_table_id: from, to_table_id: to, transferred_by: null, created_at: createdAt });

describe('dashboard Live opérationnel', () => {
  it('compte uniquement les présences actuelles, y compris les invités, avec la capacité des zones', () => {
    const result = liveDashboard([table('1', zoneA, 5, 2), table('2', zoneA), table('3', zoneB, 4)], [zoneA, zoneB], [draft('2', 6, 1)]);
    expect(result.present).toBe(11);
    expect(result.capacity).toBe(320);
    expect(result.fillRate).toBe(3);
    expect(result.occupied).toBe(2);
    expect(result.available).toBe(1);
    expect(result.activeDraftCount).toBe(1);
    expect(result.pendingPeople).toBe(7);
  });

  it('conserve les brouillons hors des occupations et localise un transfert sur sa table de destination', () => {
    const source = table('10', zoneA);
    const destination = table('24', zoneB, 7);
    const sourceSummary = liveZoneDashboard([source, destination], zoneA);
    const destinationSummary = liveZoneDashboard([source, destination], zoneB);
    expect(sourceSummary.present).toBe(0);
    expect(destinationSummary.present).toBe(7);
    expect(destinationSummary.occupied).toBe(1);
  });

  it('classe le remplissage selon les seuils visuels demandés', () => {
    expect(liveLoadStatus(39)).toBe('calme');
    expect(liveLoadStatus(40)).toBe('modere');
    expect(liveLoadStatus(70)).toBe('forte_affluence');
    expect(liveLoadStatus(90)).toBe('presque_complet');
  });

  it('met à jour et nettoie l’horloge localement sans appel Supabase par seconde', () => {
    expect(dashboardSource).toContain("window.setInterval(() => setNow(new Date()), 1000)");
    expect(dashboardSource).toContain('window.clearInterval(clockInterval)');
    const clockEffect = dashboardSource.slice(dashboardSource.indexOf('useEffect(() => {\n    setNow'), dashboardSource.indexOf('useEffect(() => {\n    let active'));
    expect(clockEffect).not.toContain('supabase');
    expect(dashboardSource).toContain('formatNightElapsed');
  });

  it('conserve les cartes cliquables et les abonnements Realtime existants', () => {
    expect(dashboardSource).not.toContain('<GlobalSearch');
    expect(dashboardSource).toContain('Ouvrir la vue salle');
    expect(dashboardSource).toContain('/hostess?zone=');
    expect(dashboardSource).toContain("table: 'occupancies'");
    expect(dashboardSource).toContain("table: 'arrival_drafts'");
  });

  it('produit une timeline métier triée, limitée et sans doublon technique', () => {
    const events = liveActivity([visit('v1', '1', '2026-08-30T01:00:00Z', '2026-08-30T01:05:00Z'), visit('v2', '2', '2026-08-30T01:10:00Z')], [transfer('t1', 'v2', '2', '3', '2026-08-30T01:12:00Z')], [{ ...draft('4', 5), created_at: '2026-08-30T01:11:00Z' }], 4);
    expect(events.map((event) => event.kind)).toEqual(['transfer', 'draft', 'sale_started', 'sale_ended']);
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
    expect(liveActivity([visit('v2', '2', '2026-08-30T01:10:00Z')], [], [], 1)).toHaveLength(1);
  });

  it('signale les alertes réellement utiles et masque le bloc lorsque la liste est vide', () => {
    const crowded = { ...zoneA, max_capacity: 10 };
    const alerts = liveDashboardAlerts([table('1', crowded, 9)], [crowded], [{ ...draft('1', 2), created_at: '2026-08-30T01:00:00Z' }], [transfer('t1', 'v', '1', '2', '2026-08-30T01:01:00Z'), transfer('t2', 'v', '2', '3', '2026-08-30T01:02:00Z')], new Date('2026-08-30T01:11:00Z'));
    expect(alerts.some((alert) => alert.label.includes('90 %'))).toBe(true);
    expect(alerts.some((alert) => alert.label.includes('11 min'))).toBe(true);
    expect(liveDashboardAlerts([table('2', zoneB), table('3', zoneB), table('4', zoneB)], [zoneB], [], [], new Date()).length).toBe(0);
    expect(dashboardSource).toContain('{alerts.length > 0 &&');
    expect(dashboardSource).not.toContain('Rien à signaler');
  });

  it('calcule les arrivées récentes dans le carré de localisation actuelle', () => {
    const source = table('10', zoneA);
    const destination = table('24', zoneB);
    const moved = { ...visit('moved', '10', '2026-08-30T01:20:00Z'), current_table_id: '24' };
    expect(recentArrivalsByZone([source, destination], [moved], new Date('2026-08-30T01:00:00Z'))).toEqual({ [zoneB.id]: 7 });
  });

  it('expose les actions rapides, la synchronisation réelle et le nettoyage des listeners', () => {
    expect(dashboardSource).toContain("router.push('/hostess')");
    expect(dashboardSource).toContain("router.push('/hostess?view=entrees')");
    expect(dashboardSource).toContain("router.push('/hostess?view=piste')");
    expect(dashboardSource).toContain("router.push('/hostess?view=promoteurs')");
    expect(dashboardSource).toContain('grid-cols-2 gap-2 sm:grid-cols-4');
    expect(dashboardSource).not.toContain('focusSearch');
    expect(dashboardSource).toContain("status === 'SUBSCRIBED'");
    expect(dashboardSource).toContain("status === 'CHANNEL_ERROR'");
    expect(dashboardSource).toContain("window.addEventListener('offline'");
    expect(dashboardSource).toContain("window.removeEventListener('offline'");
    expect(dashboardSource).toContain("table: 'table_visits'");
    expect(dashboardSource).toContain("table: 'table_visit_transfers'");
    expect(dashboardSource).toContain("rpc('current_operational_night_started_at')");
    expect(dashboardSource).toContain("'Aucune soirée active'");
    expect(dashboardSource).toContain('formatNightElapsed(nightStartedAt, now)');
    expect(dashboardSource).toContain('Soirée en cours ·');
    expect(hostessHubSource).toContain("searchParams.get('view')");
    expect(hostessHubSource).toContain("setView('salle')");
  });

  it('priorise les actions avant les KPI, puis limite l’activité à trois éléments par défaut', () => {
    const kpis = dashboardSource.indexOf('aria-label="Indicateurs Live"');
    const squares = dashboardSource.indexOf('aria-label="État des carrés"');
    const actions = dashboardSource.indexOf('aria-label="Actions rapides"');
    const activity = dashboardSource.indexOf('aria-label="Activité récente"');
    expect(actions).toBeGreaterThan(-1);
    expect(kpis).toBeGreaterThan(actions);
    expect(squares).toBeGreaterThan(kpis);
    expect(activity).toBeGreaterThan(squares);
    expect(dashboardSource).toContain('visibleActivities.slice(0, 3)');
    expect(dashboardSource).toContain("showAllActivity ? 'Réduire' : 'Voir plus'");
    expect(dashboardSource).not.toContain('État de la salle');
  });
});
