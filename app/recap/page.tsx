import { AuthGate } from '@/components/auth-gate';
import { Navigation } from '@/components/navigation';
import { RecapConsole } from '@/components/recap-console';

export default function RecapPage() {
  return <AuthGate requireAdmin><Navigation /><RecapConsole /></AuthGate>;
}
