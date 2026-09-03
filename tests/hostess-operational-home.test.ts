import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const home = file('app/page.tsx');
const roleHome = file('components/role-home.tsx');
const hostess = file('components/hostess-console.tsx');
const navigation = file('components/navigation.tsx');
const gate = file('components/auth-gate.tsx');
const configuration = file('supabase/migrations/0008_real_operational_configuration.sql');

describe('accueil opérationnel Hôtesse par rôle', () => {
  it('affiche les Carrés par défaut pour l’Hôtesse et conserve Live pour l’Admin', () => {
    expect(home).toContain('<RoleHome />');
    expect(roleHome).toContain("role === 'hostess' && searchParams.get('view') !== 'live'");
    expect(roleHome).toContain('<HostessConsole tables={[]} initialScreen="overview" />');
    expect(roleHome).toContain('return <LiveDashboard initialTables={[]} />');
  });

  it('conserve les quatre Carrés réels dans leur ordre métier', () => {
    for (const value of ["('Carré 1', 1", "('Carré 2', 2", "('Carré 3', 3", "('Backstage', 4"]) expect(configuration).toContain(value);
    expect(hostess).toContain('.sort((left, right) => left.display_order - right.display_order)');
    expect(hostess).toContain('overviewZones.map(({ zone: item, ranks })');
  });

  it('réutilise les cartes CDR et mini-tables au lieu de dupliquer leur rendu', () => {
    expect(hostess).toContain('function CdrRankCard');
    expect(hostess).toContain('ranks.map((rank) => <CdrRankCard');
    expect(hostess).toContain('cdrRanks.map((rank) => <CdrRankCard');
    expect(hostess).toContain('rank.tables.map((table) => <RankTableIndicator');
    expect(hostess).toContain('presentTotal(table) > 0');
  });

  it('ouvre directement la fiche existante ou le détail du rang', () => {
    expect(hostess).toContain('onOpenTable={openTable}');
    expect(hostess).toContain('openOverviewRank(item, headWaiterId)');
    expect(hostess).toContain('event.stopPropagation(); onOpen(table);');
  });

  it('priorise la fiche table sur le rendu de l’overview sans quitter cet écran', () => {
    const readOnlyTable = hostess.indexOf('if (editing && !editingMode)');
    const editableTable = hostess.indexOf('if (editing && editingMode)');
    const overview = hostess.indexOf("if (screen === 'overview')");
    expect(readOnlyTable).toBeGreaterThan(-1);
    expect(editableTable).toBeGreaterThan(readOnlyTable);
    expect(overview).toBeGreaterThan(editableTable);
    expect(hostess).toContain('const backToColumns = () => {');
    expect(hostess).toContain('setEditing(null); setEditingMode(false);');
  });

  it('garde la recherche globale et Nouvelle arrivée immédiatement accessibles', () => {
    const overview = hostess.slice(hostess.indexOf("if (screen === 'overview')"), hostess.indexOf("if (screen === 'zones')"));
    expect(navigation).toContain("role === 'hostess' && <HostessGlobalSearch />");
    expect(overview).not.toContain('<GlobalSearch');
    expect(overview).toContain("router.push('/hostess')");
    expect(overview).toContain('Nouvelle arrivée');
  });

  it('expose Vue Live à l’Hôtesse via un query param sans retirer le dashboard', () => {
    expect(navigation).toContain("role === 'hostess'");
    expect(navigation).toContain("href={'/?view=live' as any}");
    expect(navigation).toContain('Vue Live');
    expect(roleHome).toContain("searchParams.get('view')");
  });

  it('réutilise le rôle déjà contrôlé par AuthGate sans deuxième lecture de profil', () => {
    expect(gate).toContain('AppRoleContext.Provider');
    expect(navigation).toContain('useAppRole()');
    expect(navigation).not.toContain("from('profiles')");
  });

  it('reste responsive et conserve une seule subscription par flux', () => {
    expect(hostess).toContain('grid grid-cols-1 gap-4 lg:grid-cols-2');
    expect(hostess).toContain('min-[520px]:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2');
    expect(hostess.match(/supabase\.channel\('hostess-live'\)/g)).toHaveLength(1);
  });

  it('conserve les deep links table et zone existants', () => {
    expect(hostess).toContain("searchParams.get('table')");
    expect(hostess).toContain("searchParams.get('zone')");
    expect(hostess).toContain('setEditing(requestedTable)');
  });
});
