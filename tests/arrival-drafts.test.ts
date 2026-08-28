import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/0011_arrival_drafts_and_sales.sql'), 'utf8');
const hostess = readFileSync(resolve(process.cwd(), 'components/hostess-console.tsx'), 'utf8');

describe('brouillons et ventes de tables', () => {
  it('stocke un brouillon séparément de l’occupation définitive', () => {
    expect(migration).toContain('create table if not exists public.arrival_drafts');
    expect(migration).toContain("status text not null default 'draft'");
    const prepare = migration.slice(migration.indexOf('prepare_arrival_draft'), migration.indexOf('move_arrival_draft'));
    expect(prepare).not.toContain('insert into public.occupancies');
    expect(prepare).not.toContain('insert into public.table_visits');
  });

  it('permet de déplacer un brouillon sans créer de visite sur la première table', () => {
    const move = migration.slice(migration.indexOf('move_arrival_draft'), migration.indexOf('confirm_arrival_draft'));
    expect(move).toContain('set table_id = p_table_id');
    expect(move).toContain('The selected table does not support this group');
    expect(move).not.toContain('insert into public.table_visits');
  });

  it('confirme une arrivée par une unique occupation, qui déclenche une unique visite', () => {
    const confirm = migration.slice(migration.indexOf('confirm_arrival_draft'), migration.indexOf('release_operational_table'));
    expect(confirm).toContain('for update');
    expect(confirm).toContain('insert into public.occupancies');
    expect(confirm).toContain("status = 'confirmed'");
    expect(confirm).toContain('This table has just been occupied by another user');
  });

  it('protège les doubles confirmations et deux hôtesses sur une même table', () => {
    expect(migration).toContain('arrival_drafts_one_open_per_table');
    expect(migration).toContain('table_visits_one_open_per_table');
    expect(migration).toContain('Draft already confirmed or unavailable');
  });

  it('attribue automatiquement le numéro de vente dans la même soirée', () => {
    expect(migration).toContain('add column if not exists sale_number integer');
    expect(migration).toContain('coalesce(max(sale_number), 0) + 1');
    expect(migration).toContain('partition by night_session_id, table_id');
  });

  it('ferme une vente lors de la libération sans la supprimer', () => {
    const release = migration.slice(migration.indexOf('release_operational_table'));
    expect(release).toContain('update public.occupancies set present_people = 0');
    expect(release).not.toContain('delete from public.table_visits');
  });

  it('réserve les fonctions aux rôles opérationnels et préserve la lecture historique admin', () => {
    expect(migration).toContain("public.current_role() not in ('admin', 'hostess')");
    expect(migration).toContain("hostess reads active sales");
    expect(migration).toContain("ended_at is null");
  });

  it('propose la double validation et bloque le double clic dans l’interface', () => {
    expect(hostess).toContain('Préparer l’arrivée');
    expect(hostess).toContain('Confirmer l’installation sur la Table');
    expect(hostess).toContain('Changer de table');
    expect(hostess).toContain("disabled={confirming}");
    expect(hostess).toContain("'Confirmation...'");
  });

  it('affiche le brouillon et le numéro de vente sans surcharger les cartes', () => {
    expect(hostess).toContain("label: 'BROUILLON'");
    expect(hostess).toContain('Vente #{activeSales[table.id]}');
  });
});
