import { AuthPanel } from '@/components/auth-panel';
import { LiveDashboard } from '@/components/live-dashboard';
import { Navigation } from '@/components/navigation';

export default function Home() {
  return <><AuthPanel /><Navigation /><LiveDashboard initialTables={[]} /></>;
}
