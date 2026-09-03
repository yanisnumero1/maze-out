import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const migration = file('supabase/migrations/0018_operational_table_transfers.sql');
const hostess = file('components/hostess-console.tsx');
const operations = file('components/hostess-operations.tsx');

describe('transferts opérationnels et revue terrain', () => {
  it('conserve la vente d’origine et backfill sa localisation courante', () => {
    expect(migration).toContain('add column if not exists current_table_id');
    expect(migration).toContain('set current_table_id = table_id');
    expect(migration).toContain('table_visits_one_open_per_current_table');
    expect(migration).toContain('current_table_id = p_to_table_id');
    expect(migration).toContain('table_visit_transfers');
  });

  it('effectue le transfert atomiquement avec contrôles de concurrence et capacité', () => {
    const rpc = migration.slice(migration.indexOf('transfer_operational_table'));
    for (const text of ['for update', 'Destination is already occupied', 'Destination has an arrival draft', 'Destination capacity is insufficient', "set_config('mazeout.transfer_in_progress', 'on', true)"]) expect(rpc).toContain(text);
    expect(rpc).toContain("public.current_role() not in ('admin', 'hostess')");
    expect(rpc).toContain('grant execute on function public.transfer_operational_table(uuid, uuid) to authenticated');
  });

  it('ne crée ni vente ni sale_number pendant un transfert et continue les futures ventes depuis la destination courante', () => {
    const rpc = migration.slice(migration.indexOf('transfer_operational_table'));
    expect(rpc).not.toContain('insert into public.table_visits');
    expect(rpc).not.toContain('sale_number =');
    expect(migration).toContain('where current_table_id = v_table_id and ended_at is null');
    expect(migration).toContain('where night_session_id = v_night_id and table_id = v_table_id');
  });

  it('donne à la Hôtesse la lecture des ventes de la soirée active, sans les soirées clôturées', () => {
    expect(migration).toContain('hostess reads active night table visits');
    expect(migration).toContain('public.is_active_night_session(night_session_id)');
    expect(hostess).toContain('Historique de la soirée');
    expect(hostess).toContain('Vente #{visit.sale_number');
    expect(hostess).toContain('Transfert : Table');
  });

  it('préserve la revente, la recherche dans les carrés et le déplacement de brouillon', () => {
    expect(hostess).toContain("hasPreviousSale ? 'Revendre la table' : 'Préparer l’arrivée'");
    expect(hostess).not.toContain('<GlobalSearch');
    expect(hostess).toContain('table.id !== displayedDraft?.table_id');
    expect(hostess).toContain('presentTotal(table) === 0 && !draft');
  });

  it('utilise la ligne de destination comme sélection tactile avant la confirmation RPC', () => {
    expect(hostess).toContain('availableTransferTargets.map((table) => <button');
    expect(hostess).toContain('setTransferTargetId(table.id); setTransferConfirm(true)');
    expect(hostess).toContain('Transférer la Table {editing.display_number} vers la Table {transferTarget.display_number} ?');
    expect(hostess).toContain('Annuler');
    expect(hostess).toContain("transferBusy ? 'Transfert en cours...' : 'Confirmer le transfert'");
    expect(hostess).toContain('focus-visible:ring-violet-400');
    expect(hostess).toContain('group-hover:translate-x-0.5');
  });

  it('permet d’effacer temporairement les compteurs sans contourner les limites', () => {
    expect(hostess).toContain("if (value === 0) setInput('')");
    expect(hostess).toContain("onBlur={() => set(input === '' ? 0 : Number(input))}");
    expect(hostess).toContain('clamp(next, max)');
    expect(operations).toContain("if (value === '') return ''");
    expect(operations).toContain("Number(value) > 0 ? Number(value) : null");
  });
});
