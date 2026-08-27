import { AdminConsole } from '@/components/admin-console';
import { AuthGate } from '@/components/auth-gate';
import { Navigation } from '@/components/navigation';

export default function AdminPage() {
  return <AuthGate requireAdmin><Navigation /><AdminConsole tables={[]} /></AuthGate>;
}
