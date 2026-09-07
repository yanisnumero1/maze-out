'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { useAppRole } from '@/components/auth-gate';
import { HostessGlobalSearch } from '@/components/hostess-global-search';

export function Navigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const role = useAppRole();

  const linkClass = (active: boolean) => `nav-link ${active ? 'nav-link-active' : ''}`;

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) console.error('[AUTH] Déconnexion impossible.', error);
    router.replace('/login' as any);
  }

  return <>
    <nav className={`topbar ${role === 'hostess' ? 'mb-2' : 'mb-5'}`}>
      <div className="topbar-inner">
      <Link href="/" className="brand-mark" aria-label="MAZE-OUT — Accueil">
        <Image src="/bridge-logo.png" alt="BRIDGE — Pont Alexandre III" width={160} height={57} className="h-7 w-28 object-contain sm:h-8 sm:w-32" />
        <span>MAZE-OUT</span>
      </Link>
      <div className="nav-scroll">
        {role === 'cdr' ? <Link className={linkClass(pathname.startsWith('/cdr'))} href="/cdr">Live</Link> : <>
        <Link className={linkClass(pathname === '/' && searchParams.get('view') !== 'live')} href="/">Accueil</Link>
        {role === 'hostess' && <Link className={linkClass(pathname === '/' && searchParams.get('view') === 'live')} href={'/?view=live' as any}>Vue Live</Link>}
        <Link className={linkClass(pathname.startsWith('/hostess'))} href="/hostess">Arrivée</Link>
        {role === 'admin' && <Link className={linkClass(pathname.startsWith('/admin'))} href="/admin">Administration</Link>}
        {role === 'admin' && <Link className={linkClass(pathname.startsWith('/recap'))} href={'/recap' as any}>Récapitulatif</Link>}
        </>}
        <button className="signout-button" onClick={() => void signOut()}>Se déconnecter</button>
      </div>
      </div>
    </nav>
    {role === 'hostess' && <HostessGlobalSearch />}
  </>;
}
