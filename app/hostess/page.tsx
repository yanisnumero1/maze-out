import { AuthGate } from '@/components/auth-gate';
import { HostessHub } from '@/components/hostess-hub';
import { Navigation } from '@/components/navigation';

export default function HostessPage() {
  return <AuthGate><Navigation /><HostessHub tables={[]} /></AuthGate>;
}
