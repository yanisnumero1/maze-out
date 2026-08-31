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
  return <><div className="-mx-1 mb-5 flex snap-x gap-2 overflow-x-auto px-1 pb-1">{(Object.keys(labels) as View[]).map((item) => <button key={item} onClick={() => setView(item)} className={view === item ? 'min-h-11 snap-start whitespace-nowrap rounded-full bg-fuchsia-600 px-4 py-2 text-sm font-bold' : 'min-h-11 snap-start whitespace-nowrap rounded-full bg-zinc-800 px-4 py-2 text-sm font-bold'}>{labels[item]}</button>)}</div>{view === 'salle' ? <HostessConsole tables={tables} /> : <HostessOperations view={view} />}</>;
}
