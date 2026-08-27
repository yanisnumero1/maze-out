import { AuthGate } from '@/components/auth-gate';
import { HostessConsole } from '@/components/hostess-console';
import { Navigation } from '@/components/navigation';

export default function HostessPage() {
  return <AuthGate><Navigation /><HostessConsole tables={[]} /></AuthGate>;
}
