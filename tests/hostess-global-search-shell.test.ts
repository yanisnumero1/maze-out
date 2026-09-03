import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const shell = file('components/hostess-global-search.tsx');
const navigation = file('components/navigation.tsx');
const search = file('components/global-search.tsx');
const hostess = file('components/hostess-console.tsx');
const live = file('components/live-dashboard.tsx');
const hub = file('components/hostess-hub.tsx');
const cdrPage = file('app/cdr/page.tsx');

describe('recherche globale persistante Hôtesse', () => {
  it('est rendue une seule fois sous la navigation et uniquement pour le rôle Hôtesse', () => {
    expect(navigation.indexOf('<HostessGlobalSearch />')).toBeGreaterThan(navigation.indexOf('</nav>'));
    expect(navigation).toContain("role === 'hostess' && <HostessGlobalSearch />");
    expect(navigation).toContain("role === 'hostess' ? 'mb-2' : 'mb-5'");
    expect(hostess).not.toContain('<GlobalSearch');
    expect(live).not.toContain('<GlobalSearch');
    expect(cdrPage).not.toContain('Navigation');
  });

  it('couvre toutes les sous-vues Hôtesse grâce au shell commun', () => {
    expect(hub).toContain("type View = 'salle' | 'piste' | 'promoteurs' | 'entrees'");
    expect(hub).toContain('<HostessConsole tables={tables} />');
    expect(hub).toContain('<HostessOperations view={view} />');
  });

  it('charge une fois les sources utiles et maintient une seule souscription dédiée', () => {
    for (const source of ['tables', 'arrival_drafts', 'table_visits', 'business_referrers', 'promoters']) expect(shell).toContain(`from('${source}')`);
    expect(shell.match(/supabase\.channel\('hostess-global-search'\)/g)).toHaveLength(1);
    expect(shell).toContain('supabase.removeChannel(channel)');
    expect(search).not.toContain('supabase');
  });

  it('ouvre table, promoteur et rang CDR avec des deep links propres', () => {
    expect(shell).toContain('&from=global-search`');
    expect(shell).toContain('/hostess?view=promoteurs&promoter=');
    expect(shell).toContain('/hostess?zone=${encodeURIComponent(table.zone_id)}&cdr=');
    expect(hostess).toContain("const requestedCdrId = searchParams.get('cdr')");
    expect(hostess).toContain("setScreen(requestedCdrExists ? 'columns' : 'waiters')");
    expect(hostess).toContain("if (searchParams.get('from') === 'global-search') router.push('/')");
  });

  it('nettoie les états incompatibles avant d’ouvrir une table', () => {
    const tableEffect = hostess.slice(hostess.indexOf("const tableNumber = searchParams.get('table')"), hostess.indexOf('function openTable'));
    for (const reset of ["setChangingTable(false)", "setTransferring(false)", "setTransferTargetId('')", 'setTransferConfirm(false)']) expect(tableEffect).toContain(reset);
  });

  it('reste compacte, tactile et lisible sur mobile', () => {
    expect(search).toContain('w-full max-w-4xl');
    expect(search).toContain('min-h-11 w-full');
    expect(search).toContain('max-h-[min(24rem,55dvh)]');
    expect(search).toContain('Rechercher une table, réservation, apporteur, promoteur ou CDR…');
    expect(search).toContain('sm:hidden');
    expect(search).toContain('Rechercher…');
    expect(search).toContain('Aucun résultat');
  });

  it('intègre visuellement le champ sans carte ni titre visible', () => {
    expect(search).not.toContain('className="panel');
    expect(search).not.toContain('>Recherche rapide</label>');
    expect(search).toContain('className="sr-only"');
    expect(search).toContain('aria-label="Recherche globale"');
    expect(search).toContain('<svg aria-hidden="true"');
  });

  it('conserve le focus lors de l’effacement et place les résultats sous le champ', () => {
    expect(search).toContain('onMouseDown={(event) => event.preventDefault()}');
    expect(search).toContain("inputRef.current?.focus()");
    expect(search).toContain('absolute left-0 right-0 z-50 mt-1');
    for (const label of ['TABLE', 'RÉSERVATION', 'APPORTEUR', 'PROMOTEUR', 'CDR']) expect(search).toContain(`'${label}'`);
    expect(search).toContain('onClick={() => choose(result)}');
  });
});
