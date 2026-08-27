'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import type { AppRole } from '@/components/auth-gate';

export function Navigation() {
  const router = useRouter();
  const [role, setRole] = useState<AppRole | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', data.session.user.id)
        .single();
      if (!error && (profile?.role === 'admin' || profile?.role === 'hostess') && active) {
        setRole(profile.role);
      }
    });
    return () => { active = false; };
  }, []);

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) console.error('[AUTH] Déconnexion impossible.', error);
    router.replace('/login' as any);
  }

  return (
    <nav className="mb-5 flex items-center gap-2 border-b border-zinc-800 pb-3 text-sm">
      <Link href="/" className="mr-auto flex items-center">
        <Image src="/bridge-logo.png" alt="BRIDGE — Pont Alexandre III" width={160} height={57} className="h-8 w-32 object-contain" />
      </Link>
      <Link className="rounded-full bg-zinc-800 px-3 py-2 font-semibold" href="/">Accueil</Link>
      <Link className="rounded-full bg-fuchsia-600 px-3 py-2 font-semibold" href="/hostess">Hôtesse</Link>
      {role === 'admin' && <Link className="rounded-full bg-zinc-800 px-3 py-2 font-semibold" href="/admin">Administration</Link>}
      {role === 'admin' && <Link className="rounded-full bg-zinc-800 px-3 py-2 font-semibold" href={'/recap' as any}>Récapitulatif</Link>}
      <button className="rounded-full bg-zinc-800 px-3 py-2 font-semibold" onClick={() => void signOut()}>Se déconnecter</button>
    </nav>
  );
}
