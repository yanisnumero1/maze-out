'use client';

import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';

export type AppRole = 'admin' | 'hostess' | 'cdr';
const AppRoleContext = createContext<AppRole | null>(null);
export const useAppRole = () => useContext(AppRoleContext);

export function AuthGate({ children, requireAdmin = false, requireCdr = false }: { children: React.ReactNode; requireAdmin?: boolean; requireCdr?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<'checking' | 'allowed'>('checking');
  const [allowedRole, setAllowedRole] = useState<AppRole | null>(null);

  useEffect(() => {
    let active = true;

    async function check(session: Session | null) {
      if (!session) {
        if (active) router.replace('/login' as any);
        return;
      }

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('role, cdr_access_disabled_at')
        .eq('id', session.user.id)
        .single();

      const role = profile?.role as AppRole | undefined;
      if (error || profile?.cdr_access_disabled_at || (role !== 'admin' && role !== 'hostess' && role !== 'cdr')) {
        console.error('[AUTH] Profil invalide ou inaccessible.', error);
        if (profile?.cdr_access_disabled_at) await supabase.auth.signOut();
        if (active) router.replace('/login' as any);
        return;
      }

      if (requireAdmin && role !== 'admin') {
        if (active) router.replace(role === 'cdr' ? '/cdr' : '/');
        return;
      }

      if (requireCdr && role !== 'cdr') {
        if (active) router.replace('/');
        return;
      }

      if (!requireCdr && role === 'cdr') {
        if (active) router.replace('/cdr');
        return;
      }

      if (active) { setAllowedRole(role); setState('allowed'); }
    }

    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) console.error('[AUTH] Impossible de restaurer la session.', error);
      void check(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => void check(session), 0);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [requireAdmin, requireCdr, router]);

  if (state === 'checking') {
    return <p className="p-5 text-center text-sm text-zinc-400">Connexion en cours...</p>;
  }

  return <AppRoleContext.Provider value={allowedRole}>{children}</AppRoleContext.Provider>;
}
