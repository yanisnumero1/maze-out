import { AuthGate } from '@/components/auth-gate';
import { LiveDashboard } from '@/components/live-dashboard';
import { Navigation } from '@/components/navigation';

export default function Home() {
  return <AuthGate><Navigation /><LiveDashboard initialTables={[]} /></AuthGate>;
}
