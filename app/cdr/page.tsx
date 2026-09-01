import { AuthGate } from '@/components/auth-gate';
import { CdrConsole } from '@/components/cdr-console';

export default function CdrPage() {
  return <AuthGate requireCdr><CdrConsole /></AuthGate>;
}
