import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const gate = file('components/auth-gate.tsx');
const navigation = file('components/navigation.tsx');
const home = file('app/page.tsx');
const hostess = file('app/hostess/page.tsx');
const admin = file('app/admin/page.tsx');
const recap = file('app/recap/page.tsx');
const cdr = file('app/cdr/page.tsx');

describe('authentification et navigation', () => {
  it('redirige les visiteurs sans session vers /login', () => {
    expect(gate).toContain("router.replace('/login' as any)");
    expect(gate).toContain('Connexion en cours...');
  });

  it('empêche une hôtesse d’accéder à /admin', () => {
    expect(admin).toContain('<AuthGate requireAdmin>');
    expect(gate).toContain("router.replace('/')");
  });

  it('réserve /recap aux administrateurs', () => {
    expect(recap).toContain('<AuthGate requireAdmin>');
  });

  it('isole le rôle CDR sur sa page Live dédiée', () => {
    expect(cdr).toContain('<AuthGate requireCdr>');
    expect(gate).toContain("role === 'cdr'");
    expect(gate).toContain("router.replace('/cdr')");
  });

  it('ne charge pas les données métier côté serveur avant le garde', () => {
    for (const source of [home, hostess, admin]) {
      expect(source).not.toContain('getLiveTables');
      expect(source).toContain('AuthGate');
    }
  });

  it('n’expose que la navigation autorisée à chaque rôle', () => {
    expect(navigation).toContain('Accueil');
    expect(navigation).toContain('Arrivée');
    expect(navigation).not.toContain('>Hôtesse</Link>');
    expect(navigation).toContain('Administration');
    expect(navigation).toContain("role === 'admin'");
    expect(navigation).toContain('Récapitulatif');
    expect(navigation).toContain("role === 'cdr'");
    expect(navigation).toContain('>Live</Link>');
  });

  it('propose une déconnexion vers la page de connexion', () => {
    expect(navigation).toContain('supabase.auth.signOut()');
    expect(navigation).toContain("router.replace('/login' as any)");
  });

  it('met en évidence exactement l’onglet correspondant au chemin courant', () => {
    expect(navigation).toContain('usePathname');
    expect(navigation).toContain("pathname === '/'");
    expect(navigation).toContain("pathname.startsWith('/hostess')");
    expect(navigation).toContain("pathname.startsWith('/admin')");
    expect(navigation).toContain("pathname.startsWith('/recap')");
    expect(navigation).toContain("active ? 'nav-link-active' : ''");
  });

  it('ne traite jamais la déconnexion comme un onglet actif', () => {
    const signOutButton = navigation.slice(navigation.indexOf('<button'), navigation.indexOf('</button>') + '</button>'.length);
    expect(signOutButton).not.toContain('linkClass(');
    expect(signOutButton).toContain('Se déconnecter');
  });
});
