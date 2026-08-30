import type { ArrivalDraft, LiveTable, TableStatus, TableVisit, TableVisitTransfer, Thresholds, Zone } from './types';
export const defaultThresholds: Thresholds = { lightOverloadFrom: 8, overloadFrom: 10 };
export const presentTotal = (table: Pick<LiveTable, 'occupancy'>) => (table.occupancy?.present_people ?? 0) + (table.occupancy?.extra_guests ?? 0);
export function computedStatus(table: Pick<LiveTable, 'active' | 'reservation' | 'occupancy' | 'standard_capacity'>, thresholds = defaultThresholds): TableStatus {
  if (!table.active) return 'unavailable'; const total = presentTotal(table);
  if (total >= thresholds.overloadFrom) return 'overload';
  if (total >= thresholds.lightOverloadFrom) return 'light_overload';
  if (total > 0) return 'occupied';
  return table.reservation?.status === 'reserved' ? 'reserved' : 'free';
}
export function stats(tables: LiveTable[], thresholds = defaultThresholds) {
  const occupied = tables.filter(t => presentTotal(t) > 0); const reserved = tables.filter(t => computedStatus(t, thresholds) === 'reserved');
  const available = tables.filter(t => computedStatus(t, thresholds) === 'free'); const capacity = tables.reduce((n,t) => n+t.standard_capacity,0);
  const present = tables.reduce((n,t) => n+presentTotal(t),0); const overload = tables.filter(t => ['overload','light_overload'].includes(computedStatus(t,thresholds))).length;
  return { present, occupied: occupied.length, reserved: reserved.length, available: available.length, overload, capacity, fillRate: capacity ? Math.round(present/capacity*100) : 0 };
}
export function recommend(tables: LiveTable[], partySize: number) { return tables.filter(t => computedStatus(t)==='free').sort((a,b) => (b.standard_capacity-partySize)-(a.standard_capacity-partySize)); }
export function zoneStats(tables: LiveTable[], zoneId: string, thresholds = defaultThresholds) { return stats(tables.filter(t => t.zone_id === zoneId), thresholds); }
export function zoneAvailabilityStatus(clients: number, maxCapacity: number | null | undefined, availableTables: number) {
  if (maxCapacity && clients >= maxCapacity) return 'complete' as const;
  if (maxCapacity && clients / maxCapacity >= 0.7) return 'charged' as const;
  if (!maxCapacity && availableTables === 0) return 'complete' as const;
  return 'open' as const;
}
export type LiveLoadStatus = 'calme' | 'modere' | 'forte_affluence' | 'presque_complet';
export function liveLoadStatus(fillRate: number): LiveLoadStatus {
  if (fillRate >= 90) return 'presque_complet';
  if (fillRate >= 70) return 'forte_affluence';
  if (fillRate >= 40) return 'modere';
  return 'calme';
}
export function liveZoneDashboard(tables: LiveTable[], zone: Zone) {
  const scoped = tables.filter((table) => table.zone_id === zone.id);
  const summary = stats(scoped);
  const capacity = zone.max_capacity ?? 0;
  const fillRate = capacity ? Math.round((summary.present / capacity) * 100) : 0;
  return { ...summary, totalTables: scoped.length, capacity, fillRate, load: liveLoadStatus(fillRate) };
}
export function liveDashboard(tables: LiveTable[], zones: Zone[], drafts: ArrivalDraft[]) {
  const summary = stats(tables);
  const capacity = zones.reduce((total, zone) => total + (zone.max_capacity ?? 0), 0);
  const fillRate = capacity ? Math.round((summary.present / capacity) * 100) : 0;
  const pendingPeople = drafts.reduce((total, draft) => total + draft.present_people + draft.extra_guests, 0);
  return {
    ...summary,
    capacity,
    fillRate,
    load: liveLoadStatus(fillRate),
    activeDraftCount: drafts.length,
    pendingPeople,
  };
}
export type LiveActivityKind = 'sale_started' | 'sale_ended' | 'transfer' | 'draft';
export type LiveActivity = { id: string; kind: LiveActivityKind; at: string; entityId?: string; tableId?: string; fromTableId?: string; toTableId?: string; saleNumber?: number | null; people?: number; };
export function liveActivity(visits: TableVisit[], transfers: TableVisitTransfer[], drafts: ArrivalDraft[], limit = 8): LiveActivity[] {
  const events: LiveActivity[] = [
    ...visits.map((visit) => ({ id: `sale-started-${visit.id}`, entityId: visit.id, kind: 'sale_started' as const, at: visit.arrived_at, tableId: visit.current_table_id ?? visit.table_id, saleNumber: visit.sale_number, people: visit.present_people + visit.extra_guests })),
    ...visits.filter((visit) => visit.ended_at).map((visit) => ({ id: `sale-ended-${visit.id}`, entityId: visit.id, kind: 'sale_ended' as const, at: visit.ended_at!, tableId: visit.current_table_id ?? visit.table_id, saleNumber: visit.sale_number, people: visit.present_people + visit.extra_guests })),
    ...transfers.map((transfer) => ({ id: `transfer-${transfer.id}`, entityId: transfer.id, kind: 'transfer' as const, at: transfer.created_at, fromTableId: transfer.from_table_id, toTableId: transfer.to_table_id })),
    ...drafts.map((draft) => ({ id: `draft-${draft.id}`, entityId: draft.id, kind: 'draft' as const, at: draft.created_at, tableId: draft.table_id, people: draft.present_people + draft.extra_guests })),
  ];
  return events.sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime()).slice(0, limit);
}
export type LiveDashboardAlert = { id: string; label: string; level: 'warning' | 'critical' };
export function liveDashboardAlerts(tables: LiveTable[], zones: Zone[], drafts: ArrivalDraft[], transfers: TableVisitTransfer[], now = new Date()): LiveDashboardAlert[] {
  const alerts: LiveDashboardAlert[] = [];
  for (const zone of zones) {
    const summary = liveZoneDashboard(tables, zone);
    if (summary.fillRate >= 90) alerts.push({ id: `capacity-${zone.id}`, label: `${zone.name} à ${summary.fillRate} %`, level: 'critical' });
    else if (summary.available <= 2) alerts.push({ id: `availability-${zone.id}`, label: `${zone.name} : ${summary.available} table${summary.available !== 1 ? 's' : ''} disponible${summary.available !== 1 ? 's' : ''}`, level: 'warning' });
  }
  for (const draft of drafts) {
    const minutes = Math.floor((now.getTime() - new Date(draft.created_at).getTime()) / 60000);
    if (minutes >= 10) alerts.push({ id: `draft-${draft.id}`, label: `Arrivée en attente depuis ${minutes} min`, level: 'warning' });
  }
  const transferCounts = transfers.reduce<Record<string, number>>((counts, transfer) => ({ ...counts, [transfer.table_visit_id]: (counts[transfer.table_visit_id] ?? 0) + 1 }), {});
  for (const [visitId, count] of Object.entries(transferCounts)) if (count >= 2) alerts.push({ id: `transfer-${visitId}`, label: `Une vente a été transférée ${count} fois`, level: 'warning' });
  return alerts.slice(0, 5);
}
export function recentArrivalsByZone(tables: LiveTable[], visits: TableVisit[], since: Date) {
  const zoneByTable = new Map(tables.map((table) => [table.id, table.zone_id]));
  return visits.filter((visit) => new Date(visit.arrived_at) >= since).reduce<Record<string, number>>((totals, visit) => {
    const zoneId = zoneByTable.get(visit.current_table_id ?? visit.table_id);
    if (zoneId) totals[zoneId] = (totals[zoneId] ?? 0) + visit.present_people + visit.extra_guests;
    return totals;
  }, {});
}
export function zoneRecommendations(tables: LiveTable[], partySize: number) { const zones=[...new Map(tables.map(t=>[t.zone.id,t.zone])).values()]; return zones.map(zone=>{const scoped=tables.filter(t=>t.zone_id===zone.id);const s=stats(scoped);const candidates=recommend(scoped,partySize).slice(0,3);return {zone,stats:s,tables:candidates,score:s.available*100+(s.capacity-s.present)*2-s.fillRate-s.overload*30};}).filter(x=>x.tables.length>0).sort((a,b)=>b.score-a.score); }
export type LiveAlert={level:'critical'|'warning';label:string};
export function alerts(tables: LiveTable[]):LiveAlert[] { const zones=[...new Map(tables.map(t=>[t.zone.id,t.zone])).values()]; const zoneLoad=zones.map(z=>({zone:z,fillRate:zoneStats(tables,z.id).fillRate}));const lowest=zoneLoad.reduce((a,b)=>a.fillRate<b.fillRate?a:b,{zone:{name:''} as any,fillRate:100});const highest=zoneLoad.reduce((a,b)=>a.fillRate>b.fillRate?a:b,{zone:{name:''} as any,fillRate:0});const imbalance=zoneLoad.length>1&&highest.fillRate-lowest.fillRate>=35?[{level:'warning' as const,label:`Répartition déséquilibrée — privilégier ${lowest.zone.name}`}]:[]; return [...imbalance,...zones.flatMap<LiveAlert>(z=>{const s=zoneStats(tables,z.id);return s.available===0?[{level:'critical',label:`${z.name} — aucune table disponible`}]:s.available<=2?[{level:'warning',label:`${z.name} — seulement ${s.available} table(s) disponible(s)`}]:[]}),...tables.flatMap<LiveAlert>(t=>{const total=presentTotal(t);const number=t.display_number??t.number;return total>=10?[{level:'critical',label:`Table ${number} — ${total} personnes`}]:total>=8?[{level:'warning',label:`Table ${number} — ${total} personnes`}]:[]})]; }
