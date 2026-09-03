import { AuthGate } from '@/components/auth-gate';
import { RoleHome } from '@/components/role-home';
import { Navigation } from '@/components/navigation';

export default function Home() {
  return <AuthGate><Navigation /><RoleHome /></AuthGate>;
}
