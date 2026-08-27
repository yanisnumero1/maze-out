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

      if (profileError || !['admin', 'hostess'].includes(profile?.role ?? '')) {
        console.error('[AUTH] Profil invalide ou inaccessible.', profileError);
        if (active) {
          setAccessDenied(true);
          setChecking(false);
        }
        return;
      }

      router.replace('/');
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
    <section className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-sm items-center">
      <div className="w-full">
        <Image
          src="/bridge-logo.png"
          alt="BRIDGE — Pont Alexandre III"
          width={480}
          height={172}
          priority
          className="mx-auto mb-12 w-64"
        />
        <div className="panel p-6 sm:p-8">
          {accessDenied ? <p className="text-center text-sm text-zinc-400">Accès non autorisé.</p> : <><h1 className="text-xl font-bold">Accès sécurisé</h1><div className="mt-6"><AuthPanel /></div></>}
        </div>
      </div>
    </section>
  );
}
