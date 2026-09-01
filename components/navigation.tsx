'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import type { AppRole } from '@/components/auth-gate';

export function Navigation() {
  const router = useRouter();
  const pathname = usePathname();
  const [role, setRole] = useState<AppRole | null>(null);

  const linkClass = (active: boolean) => `min-h-11 rounded-full px-3 py-2 text-center font-semibold ${active ? 'bg-fuchsia-600 text-white' : 'bg-zinc-800 text-zinc-100'}`;

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', data.session.user.id)
        .single();
      if (!error && (profile?.role === 'admin' || profile?.role === 'hostess' || profile?.role === 'cdr') && active) {
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
    <nav className="mb-5 border-b border-zinc-800 pb-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
      <Link href="/" className="mr-auto flex h-11 items-center">
        <Image src="/bridge-logo.png" alt="BRIDGE — Pont Alexandre III" width={160} height={57} className="h-8 w-32 object-contain" />
      </Link>
      <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
        {role === 'cdr' ? <Link className={linkClass(pathname.startsWith('/cdr'))} href="/cdr">Live</Link> : <>
        <Link className={linkClass(pathname === '/')} href="/">Accueil</Link>
        <Link className={linkClass(pathname.startsWith('/hostess'))} href="/hostess">Arrivée</Link>
        {role === 'admin' && <Link className={linkClass(pathname.startsWith('/admin'))} href="/admin">Administration</Link>}
        {role === 'admin' && <Link className={linkClass(pathname.startsWith('/recap'))} href={'/recap' as any}>Récapitulatif</Link>}
        </>}
        <button className="min-h-11 rounded-full bg-zinc-800 px-3 py-2 font-semibold" onClick={() => void signOut()}>Se déconnecter</button>
      </div>
      </div>
    </nav>
  );
}
