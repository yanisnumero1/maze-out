'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { LiveTable } from '@/lib/types';
import { HostessConsole } from '@/components/hostess-console';
import { HostessOperations } from '@/components/hostess-operations';

type View = 'salle' | 'piste' | 'promoteurs' | 'entrees';
const labels: Record<View, string> = { salle: 'Salle', piste: 'Piste', promoteurs: 'Promoteurs', entrees: 'Entrées club' };

export function HostessHub({ tables }: { tables: LiveTable[] }) {
  const searchParams = useSearchParams();
  const [view, setView] = useState<View>('salle');
  useEffect(() => {
    const requestedView = searchParams.get('view');
    if (requestedView && requestedView in labels) setView(requestedView as View);
    else setView('salle');
  }, [searchParams]);
  return <><div className="segmented-control mb-5 grid-flow-col auto-cols-fr overflow-x-auto" aria-label="Navigation opérationnelle">{(Object.keys(labels) as View[]).map((item) => <button key={item} onClick={() => setView(item)} className={`segmented-option whitespace-nowrap ${view === item ? 'segmented-option-active' : ''}`}>{labels[item]}</button>)}</div>{view === 'salle' ? <HostessConsole tables={tables} /> : <HostessOperations view={view} />}</>;
}
