import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const migration = file('supabase/migrations/0028_cdr_visit_notes.sql');
const consoleSource = file('components/cdr-console.tsx');

describe('notes et apporteur CDR sur une visite active', () => {
  it('stocke les données sur table_visits pour préserver l’historique de chaque vente', () => {
    expect(migration).toContain('alter table public.table_visits');
    expect(migration).toContain('add column if not exists cdr_comment text');
    expect(migration).toContain('add column if not exists business_referrer text');
  });

  it('limite la lecture CDR à la visite active de sa table actuelle', () => {
    expect(migration).toContain('create policy "cdr reads own active table visits"');
    expect(migration).toContain("public.current_role()::text = 'cdr'");
    expect(migration).toContain('ended_at is null');
    expect(migration).toContain('t.id = table_visits.current_table_id');
    expect(migration).toContain('t.head_waiter_id = public.cdr_head_waiter_id()');
  });

  it('utilise une RPC étroite qui vérifie rôle, visite active et table actuelle', () => {
    expect(migration).toContain('create or replace function public.update_cdr_visit_notes(');
    expect(migration).toContain("public.current_role()::text <> 'cdr'");
    expect(migration).toContain('where v.id = p_visit_id');
    expect(migration).toContain('and v.ended_at is null');
    expect(migration).toContain('t.head_waiter_id = public.cdr_head_waiter_id()');
    expect(migration).toContain('set cdr_comment = v_comment');
    expect(migration).toContain('business_referrer = v_referrer');
    expect(migration).not.toContain('present_people =');
    expect(migration).not.toContain('sale_number =');
    expect(migration).not.toContain('current_table_id =');
  });

  it('autorise vider les deux champs sans modifier les autres données métier', () => {
    expect(migration).toContain("nullif(btrim(coalesce(p_cdr_comment, '')), '')");
    expect(migration).toContain("nullif(btrim(coalesce(p_business_referrer, '')), '')");
  });

  it('affiche les champs seulement pour une visite active et sauvegarde via la RPC', () => {
    expect(consoleSource).toContain("supabase.from('table_visits').select('*').is('ended_at', null)");
    expect(consoleSource).toContain('{visit && draft &&');
    expect(consoleSource).toContain('Commentaire');
    expect(consoleSource).toContain('Apporteur d’affaires');
    expect(consoleSource).toContain("rpc('update_cdr_visit_notes'");
    expect(consoleSource).toContain('Enregistrement...');
    expect(consoleSource).toContain('Enregistré');
  });

  it('distingue visuellement une table libre d’une table occupée', () => {
    expect(consoleSource).toContain("occupied ? 'border-fuchsia-500/50 bg-fuchsia-950/30' : 'border-zinc-700 bg-zinc-900/80'");
    expect(consoleSource).toContain("occupied ? 'OCCUPÉE' : 'LIBRE'");
  });
});
