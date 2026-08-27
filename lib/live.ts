import type { LiveTable, TableStatus, Thresholds } from './types';
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
export function zoneRecommendations(tables: LiveTable[], partySize: number) { const zones=[...new Map(tables.map(t=>[t.zone.id,t.zone])).values()]; return zones.map(zone=>{const scoped=tables.filter(t=>t.zone_id===zone.id);const s=stats(scoped);const candidates=recommend(scoped,partySize).slice(0,3);return {zone,stats:s,tables:candidates,score:s.available*100+(s.capacity-s.present)*2-s.fillRate-s.overload*30};}).filter(x=>x.tables.length>0).sort((a,b)=>b.score-a.score); }
export type LiveAlert={level:'critical'|'warning';label:string};
export function alerts(tables: LiveTable[]):LiveAlert[] { const zones=[...new Map(tables.map(t=>[t.zone.id,t.zone])).values()]; const zoneLoad=zones.map(z=>({zone:z,fillRate:zoneStats(tables,z.id).fillRate}));const lowest=zoneLoad.reduce((a,b)=>a.fillRate<b.fillRate?a:b,{zone:{name:''} as any,fillRate:100});const highest=zoneLoad.reduce((a,b)=>a.fillRate>b.fillRate?a:b,{zone:{name:''} as any,fillRate:0});const imbalance=zoneLoad.length>1&&highest.fillRate-lowest.fillRate>=35?[{level:'warning' as const,label:`Répartition déséquilibrée — privilégier ${lowest.zone.name}`}]:[]; return [...imbalance,...zones.flatMap<LiveAlert>(z=>{const s=zoneStats(tables,z.id);return s.available===0?[{level:'critical',label:`${z.name} — aucune table disponible`}]:s.available<=2?[{level:'warning',label:`${z.name} — seulement ${s.available} table(s) disponible(s)`}]:[]}),...tables.flatMap<LiveAlert>(t=>{const total=presentTotal(t);const number=t.display_number??t.number;return total>=10?[{level:'critical',label:`Table ${number} — ${total} personnes`}]:total>=8?[{level:'warning',label:`Table ${number} — ${total} personnes`}]:[]})]; }
