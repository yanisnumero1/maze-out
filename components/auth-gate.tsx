'use client';

import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';

export type AppRole = 'admin' | 'hostess';

export function AuthGate({ children, requireAdmin = false }: { children: React.ReactNode; requireAdmin?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<'checking' | 'allowed'>('checking');

  useEffect(() => {
    let active = true;

    async function check(session: Session | null) {
      if (!session) {
        if (active) router.replace('/login' as any);
        return;
      }

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single();

      const role = profile?.role as AppRole | undefined;
      if (error || (role !== 'admin' && role !== 'hostess')) {
        console.error('[AUTH] Profil invalide ou inaccessible.', error);
        if (active) router.replace('/login' as any);
        return;
      }

      if (requireAdmin && role !== 'admin') {
        if (active) router.replace('/');
        return;
      }

      if (active) setState('allowed');
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
  }, [requireAdmin, router]);

  if (state === 'checking') {
    return <p className="p-5 text-center text-sm text-zinc-400">Connexion en cours...</p>;
  }

  return <>{children}</>;
}
