import type { RecapAnalytics, RecapRanking } from '@/lib/recap';

const width = (value: number, maximum: number) => `${maximum > 0 ? Math.max(4, Math.round((value / maximum) * 100)) : 0}%`;

function RankingBars({ rows, valueLabel = 'ventes' }: { rows: RecapRanking[]; valueLabel?: string }) {
  const maximum = Math.max(0, ...rows.map((row) => row.sales));
  if (!rows.length) return <p className="text-sm text-zinc-400">Aucune donnée pour cette soirée.</p>;
  return <div className="grid gap-3">{rows.map((row, index) => <article className="rounded-xl bg-zinc-800/80 p-3" key={row.id}><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><b className="mr-auto min-w-0 break-words">{index < 3 && <span className="mr-2 rounded-full bg-violet-500/20 px-2 py-1 text-xs text-violet-200">#{index + 1}</span>}{row.label}</b><span className="text-sm font-bold text-zinc-200">{row.sales} {valueLabel}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-950"><div className="h-full rounded-full bg-fuchsia-500" style={{ width: width(row.sales, maximum) }} /></div><p className="mt-2 text-xs text-zinc-400">{row.people} personnes · {row.tables} tables · {row.rotations} rotation{row.rotations !== 1 ? 's' : ''} · {row.share} %</p></article>)}</div>;
}

function TableRanking({ title, tables, measure }: { title: string; tables: RecapAnalytics['tableRows']; measure: 'sales' | 'people' }) {
  const maximum = Math.max(0, ...tables.map((table) => table[measure]));
  return <section className="panel min-w-0 p-4"><h3 className="text-lg font-black">{title}</h3>{tables.length ? <div className="mt-4 grid gap-3">{tables.map((table, index) => <article className="rounded-xl bg-zinc-800/80 p-3" key={table.tableId}><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><b className="mr-auto">#{index + 1} · Table {table.tableNumber}</b><span className="text-sm font-bold">{table[measure]} {measure === 'sales' ? 'ventes' : 'personnes'}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-950"><div className="h-full rounded-full bg-violet-500" style={{ width: width(table[measure], maximum) }} /></div><p className="mt-2 text-xs text-zinc-400">{table.zone?.name ?? '—'} · {table.waiter ? `${table.waiter.first_name} ${table.waiter.last_name}`.trim() : 'CDR non attribué'} · {table.sales} vente{table.sales !== 1 ? 's' : ''} · {table.people} personnes</p></article>)}</div> : <p className="mt-3 text-sm text-zinc-400">Aucune table exploitée.</p>}</section>;
}

export function RecapAnalyticsPanel({ analytics, entries, notesCount, businessReferrerCount }: { analytics: RecapAnalytics; entries: number; notesCount: number; businessReferrerCount: number }) {
  const topWaiter = analytics.waiters[0];
  const topZone = analytics.zones[0];
  const topRotation = analytics.topSalesTables[0];
  const topPromoter = analytics.promoters[0];
  const points = [
    topWaiter && `CDR le plus actif : ${topWaiter.label} avec ${topWaiter.sales} ventes.`,
    topZone && `Carré le plus actif : ${topZone.label} avec ${topZone.share} % des ventes.`,
    topRotation && `Table la plus sollicitée : Table ${topRotation.tableNumber} avec ${topRotation.sales} ventes.`,
    analytics.topPeopleTables[0] && `Plus forte fréquentation table : Table ${analytics.topPeopleTables[0].tableNumber} avec ${analytics.topPeopleTables[0].people} personnes.`,
    topPromoter && `Promoteur n°1 : ${topPromoter.label} avec ${topPromoter.people} personnes.`,
  ].filter(Boolean);
  return <>
    <section className="mb-8"><h2 className="mb-3 text-xl font-black">RÉSUMÉ DE LA SOIRÉE</h2><div className="grid gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4">{[['VENTES TOTALES', analytics.totalSales], ['PERSONNES AUX TABLES', analytics.totalPeople], ['TABLES EXPLOITÉES', analytics.distinctTables], ['ROTATIONS / REVENTES', analytics.rotations], ['TRANSFERTS', analytics.transferredVisits], ['ENTRÉES CLUB', entries], ['PROMOTEURS', analytics.promoters.reduce((sum, promoter) => sum + promoter.people, 0)], ['NOTES PISTE', notesCount], ['APPORTEURS', businessReferrerCount]].map(([label, value]) => <article className="panel min-w-0 p-4" key={String(label)}><p className="text-xs font-black tracking-[.12em] text-zinc-400">{label}</p><b className="mt-2 block break-words text-2xl sm:text-3xl">{value}</b></article>)}</div></section>
    {points.length > 0 && <section className="mb-8 rounded-2xl border border-violet-500/25 bg-violet-500/5 p-4"><h2 className="text-sm font-black uppercase tracking-[.16em] text-violet-200">Points clés</h2><ul className="mt-3 grid gap-2 text-sm text-zinc-200">{points.map((point) => <li className="break-words" key={point as string}>• {point}</li>)}</ul></section>}
    <section className="grid gap-4 xl:grid-cols-2"><section className="panel min-w-0 p-4"><h2 className="text-xl font-black">VENTES PAR CDR</h2><div className="mt-4"><RankingBars rows={analytics.waiters} /></div></section><section className="panel min-w-0 p-4"><h2 className="text-xl font-black">RÉPARTITION DES VENTES PAR CARRÉ</h2><div className="mt-4"><RankingBars rows={analytics.zones} /></div></section></section>
    <section className="mt-8"><h2 className="mb-3 text-xl font-black">PERFORMANCE PAR TABLE</h2><div className="grid gap-4 xl:grid-cols-2"><TableRanking title="TOP 10 · PLUS DE VENTES" tables={analytics.topSalesTables} measure="sales" /><TableRanking title="TOP 10 · PLUS DE PERSONNES" tables={analytics.topPeopleTables} measure="people" /></div></section>
    <section className="mt-8 grid gap-4 xl:grid-cols-2"><section className="panel p-4"><h2 className="text-xl font-black">ROTATIONS DE TABLES</h2><p className="mt-3 text-sm text-zinc-300">{analytics.rotations} rotation{analytics.rotations !== 1 ? 's' : ''} sur {analytics.tableRows.filter((table) => table.sales > 1).length} table{analytics.tableRows.filter((table) => table.sales > 1).length !== 1 ? 's' : ''} ayant tourné.</p><div className="mt-4"><RankingBars rows={analytics.topSalesTables.filter((table) => table.sales > 1).map((table) => ({ id: table.tableId, label: `Table ${table.tableNumber}`, sales: table.sales, people: table.people, tables: 1, rotations: table.sales - 1, share: 0 }))} /></div></section><section className="panel p-4"><h2 className="text-xl font-black">PROMOTEURS</h2>{analytics.promoters.length ? <div className="mt-4 grid gap-3">{analytics.promoters.map((promoter, index) => <div className="flex flex-wrap items-center gap-2 rounded-xl bg-zinc-800/80 p-3" key={promoter.id}><b className="mr-auto">{index < 3 ? `#${index + 1} · ` : ''}{promoter.label}</b><span>{promoter.people} personnes · {promoter.share} %</span></div>)}</div> : <p className="mt-3 text-sm text-zinc-400">Aucun promoteur pour cette soirée.</p>}</section></section>
  </>;
}
