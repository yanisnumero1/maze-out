'use client';

import { useSearchParams } from 'next/navigation';
import { useAppRole } from '@/components/auth-gate';
import { HostessConsole } from '@/components/hostess-console';
import { LiveDashboard } from '@/components/live-dashboard';

export function RoleHome() {
  const role = useAppRole();
  const searchParams = useSearchParams();
  if (role === 'hostess' && searchParams.get('view') !== 'live') return <HostessConsole tables={[]} initialScreen="overview" />;
  return <LiveDashboard initialTables={[]} />;
}
