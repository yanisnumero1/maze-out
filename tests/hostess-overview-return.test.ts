import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const hostess = readFileSync(resolve(process.cwd(), 'components/hostess-console.tsx'), 'utf8');
const roleHome = readFileSync(resolve(process.cwd(), 'components/role-home.tsx'), 'utf8');
const live = readFileSync(resolve(process.cwd(), 'components/live-dashboard.tsx'), 'utf8');

const backHandler = hostess.slice(hostess.indexOf('const backToZones = () => {'), hostess.indexOf('const zoneState'));

describe('retour vers l’overview des Carrés', () => {
  it('rétablit explicitement l’écran overview et vide les sélections', () => {
    expect(backHandler).toContain("setScreen('overview')");
    expect(backHandler).toContain('setZone(null)');
    expect(backHandler).toContain('setSelectedWaiterId(null)');
    expect(backHandler).toContain('setEditing(null)');
    expect(backHandler).toContain('setEditingMode(false)');
  });

  it('nettoie les états transitoires susceptibles de rouvrir une vue', () => {
    for (const reset of ['setChangingTable(false)', "setTransferTargetId('')", 'setTransferConfirm(false)', 'setHandledTableParam(null)']) expect(backHandler).toContain(reset);
  });

  it('supprime les query params sans rechargement complet', () => {
    expect(backHandler).toContain("router.replace('/' as any)");
    expect(backHandler).not.toContain('window.location');
    expect(backHandler).not.toContain('router.refresh');
  });

  it('empêche un ancien paramètre zone de rouvrir le Carré pendant le retour', () => {
    expect(hostess).toContain("if (screen === 'overview' || !zoneId || tables.length === 0) return;");
    expect(hostess).toContain('[screen, searchParams, tables, zones]');
  });

  it('conserve les deep links zone et table', () => {
    expect(hostess).toContain("const zoneId = searchParams.get('zone')");
    expect(hostess).toContain("const tableNumber = searchParams.get('table')");
    expect(hostess).toContain("setScreen('waiters')");
    expect(hostess).toContain('setEditing(requestedTable)');
  });

  it('conserve le retour direct d’une mini-table vers son écran d’origine', () => {
    expect(hostess).toContain('const backToColumns = () => {');
    expect(hostess).toContain('setEditing(null); setEditingMode(false);');
    expect(hostess).toContain('onOpenTable={openTable}');
    expect(backHandler.indexOf("setScreen('overview')")).toBeGreaterThan(-1);
  });

  it('conserve le parcours CDR puis Carré puis overview', () => {
    expect(hostess).toContain("const backToWaiters = () => { setSelectedWaiterId(null); setScreen('waiters')");
    expect(hostess).toContain('<button onClick={backToWaiters}');
    expect(hostess).toContain('<button onClick={backToZones}');
  });

  it('ne modifie pas l’accueil Admin ou le dashboard Live', () => {
    expect(roleHome).toContain('return <LiveDashboard initialTables={[]} />');
    expect(live).toContain('export function LiveDashboard');
  });
});
