'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AuthPanel } from '@/components/auth-panel';
import { supabase } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);

  useEffect(() => {
    let active = true;

    async function redirectIfAuthenticated() {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) console.error('[AUTH] Impossible de restaurer la session.', sessionError);

      if (!sessionData.session) {
        if (active) {
          setAccessDenied(false);
          setChecking(false);
        }
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', sessionData.session.user.id)
        .single();

      if (profileError || !['admin', 'hostess', 'cdr'].includes(profile?.role ?? '')) {
        console.error('[AUTH] Profil invalide ou inaccessible.', profileError);
        if (active) {
          setAccessDenied(true);
          setChecking(false);
        }
        return;
      }

      router.replace(profile?.role === 'cdr' ? '/cdr' : '/');
    }

    void redirectIfAuthenticated();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      window.setTimeout(() => void redirectIfAuthenticated(), 0);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router]);

  if (checking) {
    return <p className="p-5 text-center text-sm text-zinc-400">Connexion en cours...</p>;
  }

  return (
    <section className="auth-shell">
      <div className="w-full max-w-sm">
        <Image
          src="/bridge-logo.png"
          alt="BRIDGE — Pont Alexandre III"
          width={480}
          height={172}
          priority
          className="mx-auto mb-8 w-48 sm:w-56"
        />
        <div className="panel auth-card">
          {accessDenied ? <p className="text-center text-sm text-zinc-400">Accès non autorisé.</p> : <><h1 className="auth-title">Accès sécurisé</h1><p className="auth-subtitle">Connectez-vous à votre espace opérationnel.</p><div className="mt-6"><AuthPanel /></div></>}
        </div>
      </div>
    </section>
  );
}
