import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { liveDashboard, liveLoadStatus, liveZoneDashboard } from '@/lib/live';
import type { ArrivalDraft, LiveTable, Zone } from '@/lib/types';

const dashboardSource = readFileSync(resolve(process.cwd(), 'components/live-dashboard.tsx'), 'utf8');
const zoneA: Zone = { id: 'a', name: 'Carré 1', display_order: 1, active: true, max_capacity: 230 };
const zoneB: Zone = { id: 'b', name: 'Backstage', display_order: 2, active: true, max_capacity: 90 };
const table = (id: string, zone: Zone, present = 0, extras = 0): LiveTable => ({
  id, number: id, display_number: Number(id.replace(/\D/g, '')) || 1, zone_id: zone.id, head_waiter_id: null,
  standard_capacity: 7, status: 'free', position_x: 0, position_y: 0, active: true, zone, head_waiter: null,
  reservation: null, occupancy: present || extras ? { table_id: id, present_people: present, extra_guests: extras, comment: null, arrived_at: null, updated_at: '' } : null,
});
const draft = (id: string, people: number, extras = 0): ArrivalDraft => ({ id, table_id: id, actor_id: 'hostess', night_session_id: 'night', present_people: people, extra_guests: extras, comment: null, status: 'draft', confirmed_sale_number: null, created_at: '', updated_at: '', confirmed_at: null });

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
    expect(dashboardSource).toContain("second: '2-digit'");
  });

  it('conserve la recherche, les cartes cliquables et les abonnements Realtime existants', () => {
    expect(dashboardSource).toContain('<TableSearch tables={tables} drafts={drafts}');
    expect(dashboardSource).toContain('Ouvrir la vue salle');
    expect(dashboardSource).toContain('/hostess?zone=');
    expect(dashboardSource).toContain("table: 'occupancies'");
    expect(dashboardSource).toContain("table: 'arrival_drafts'");
  });
});
