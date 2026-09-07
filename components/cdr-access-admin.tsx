'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cdrAccessErrorMessage, cdrAccessStatusLabel, type CdrAccessAction, type CdrAccessRow } from '@/lib/cdr-access';
import { normalizeCdrUsername, suggestCdrUsername } from '@/lib/cdr-auth';
import { supabase } from '@/lib/supabase/client';

type Credentials = { username: string; temporaryPassword: string };
type FunctionResult = { ok?: boolean; code?: string; warning?: string; rows?: CdrAccessRow[]; username?: string; temporaryPassword?: string };

async function invokeCdrAccess(body: Record<string, unknown>): Promise<FunctionResult> {
  const { data, error } = await supabase.functions.invoke<FunctionResult>('manage-cdr-access', { body });
  if (!error) return data ?? {};
  let code: string | undefined;
  const context = 'context' in error ? (error as { context?: unknown }).context : null;
  if (context instanceof Response) {
    const payload = await context.clone().json().catch(() => null) as { code?: string } | null;
    code = payload?.code;
  }
  throw new Error(code ?? 'server_error');
}

export function CdrAccessAdmin() {
  const [rows, setRows] = useState<CdrAccessRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [username, setUsername] = useState('');
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmDisableId, setConfirmDisableId] = useState<string | null>(null);
  const requestInFlight = useRef(false);

  const available = useMemo(() => rows.filter((row) => row.status === 'none'), [rows]);
  const selected = rows.find((row) => row.headWaiterId === selectedId) ?? null;

  const load = useCallback(async () => {
    setBusy('list');
    setError('');
    try {
      const result = await invokeCdrAccess({ action: 'list' });
      setRows(result.rows ?? []);
    } catch (requestError) {
      setError(cdrAccessErrorMessage(requestError instanceof Error ? requestError.message : null));
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function chooseHeadWaiter(headWaiterId: string) {
    const row = rows.find((item) => item.headWaiterId === headWaiterId);
    setSelectedId(headWaiterId);
    setUsername(row ? suggestCdrUsername(row.firstName, row.lastName) : '');
    setCredentials(null);
    setError('');
    setNotice('');
  }

  async function run(action: CdrAccessAction, headWaiterId: string, requestedUsername?: string) {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setBusy(`${action}:${headWaiterId}`);
    setCredentials(null);
    setError('');
    setNotice('');
    try {
      const result = await invokeCdrAccess({ action, headWaiterId, username: requestedUsername });
      if (result.username && result.temporaryPassword) {
        setCredentials({ username: result.username, temporaryPassword: result.temporaryPassword });
      }
      const success = action === 'create' ? 'Accès créé.' : action === 'reset_password' ? 'Mot de passe temporaire renouvelé.' : action === 'disable' ? 'Accès désactivé.' : 'Accès réactivé.';
      setNotice(result.warning === 'audit_failed' ? `${success} La trace d’audit n’a pas pu être enregistrée.` : success);
      setConfirmDisableId(null);
      await load();
      if (action === 'create') { setSelectedId(''); setUsername(''); }
    } catch (requestError) {
      setError(cdrAccessErrorMessage(requestError instanceof Error ? requestError.message : null));
    } finally {
      requestInFlight.current = false;
      setBusy(null);
    }
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    setNotice('Copié dans le presse-papiers.');
  }

  const normalizedUsername = normalizeCdrUsername(username);

  return <section className="panel mt-8 p-4 sm:p-5" aria-labelledby="cdr-access-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-[.16em] text-fuchsia-400">Comptes et permissions</p><h2 id="cdr-access-title" className="mt-1 text-xl font-black">Accès Chefs de rang</h2><p className="mt-2 max-w-2xl text-sm text-zinc-400">Créez, réinitialisez ou désactivez un accès sans modifier le chef de rang ni son historique.</p></div>
      <button type="button" disabled={Boolean(busy)} onClick={() => void load()} className="min-h-11 rounded-lg bg-zinc-800 px-4 py-2 text-sm font-bold">Actualiser</button>
    </div>

    <form className="mt-5 grid gap-4 border-t border-zinc-800 pt-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end" onSubmit={(event) => { event.preventDefault(); if (selected && normalizedUsername) void run('create', selected.headWaiterId, normalizedUsername); }}>
      <label className="block text-sm font-bold">Chef de rang sans accès<select value={selectedId} onChange={(event) => chooseHeadWaiter(event.target.value)} className="mt-2 w-full px-3 py-2"><option value="">Sélectionner…</option>{available.map((row) => <option key={row.headWaiterId} value={row.headWaiterId}>{row.firstName} {row.lastName}</option>)}</select></label>
      <label className="block text-sm font-bold">Identifiant de connexion<input value={username} disabled={!selected} onChange={(event) => setUsername(event.target.value.toLocaleLowerCase('fr-FR'))} autoCapitalize="none" autoComplete="off" spellCheck={false} className="mt-2 w-full px-3 py-2" placeholder="prenom.nom" aria-invalid={Boolean(username) && !normalizedUsername} />{username && !normalizedUsername && <span className="mt-1 block text-xs font-normal text-red-300">L’identifiant contient des caractères non autorisés.</span>}</label>
      <button type="submit" disabled={!selected || !normalizedUsername || Boolean(busy)} className="min-h-11 rounded-lg bg-fuchsia-600 px-5 py-2 text-sm font-black">{busy?.startsWith('create:') ? 'Création…' : 'Créer l’accès'}</button>
    </form>

    {credentials && <section className="mt-5 border border-emerald-500/30 bg-emerald-500/5 p-4" aria-live="polite"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-black text-emerald-300">Identifiants temporaires</p><p className="mt-1 text-sm text-zinc-400">Copiez-les maintenant : le mot de passe ne sera plus affiché après fermeture.</p></div><button type="button" onClick={() => setCredentials(null)} className="min-h-10 text-sm font-bold text-zinc-300">Masquer</button></div><dl className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-lg bg-zinc-950 p-3"><dt className="text-xs uppercase tracking-wide text-zinc-500">Identifiant</dt><dd className="mt-1 flex items-center gap-2"><code className="min-w-0 flex-1 break-all text-sm">{credentials.username}</code><button type="button" onClick={() => void copy(credentials.username)} className="min-h-10 rounded-lg bg-zinc-800 px-3 text-xs font-bold">Copier</button></dd></div><div className="rounded-lg bg-zinc-950 p-3"><dt className="text-xs uppercase tracking-wide text-zinc-500">Mot de passe temporaire</dt><dd className="mt-1 flex items-center gap-2"><code className="min-w-0 flex-1 break-all text-sm">{credentials.temporaryPassword}</code><button type="button" onClick={() => void copy(credentials.temporaryPassword)} className="min-h-10 rounded-lg bg-zinc-800 px-3 text-xs font-bold">Copier</button></dd></div></dl></section>}

    {error && <p className="mt-4 text-sm font-semibold text-red-300" role="alert">{error}</p>}
    {notice && <p className="mt-4 text-sm font-semibold text-emerald-300" role="status">{notice}</p>}

    <div className="mt-5 overflow-x-auto touch-pan-x">
      <table className="w-full min-w-[680px] text-sm"><thead className="text-left"><tr><th>Chef de rang</th><th>Identifiant</th><th>Statut</th><th className="text-right">Actions</th></tr></thead><tbody>{rows.map((row) => <tr className="border-t border-zinc-800" key={row.headWaiterId}><td className="py-3 font-bold">{row.firstName} {row.lastName}</td><td>{row.username ?? '—'}</td><td><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${row.status === 'active' ? 'bg-emerald-500/15 text-emerald-300' : row.status === 'disabled' ? 'bg-zinc-700 text-zinc-300' : row.status === 'inconsistent' ? 'bg-red-500/15 text-red-300' : 'bg-zinc-800 text-zinc-400'}`}>{cdrAccessStatusLabel(row.status)}</span></td><td><div className="flex justify-end gap-2">{row.status === 'active' && <><button type="button" disabled={Boolean(busy)} onClick={() => void run('reset_password', row.headWaiterId)} className="min-h-10 rounded-lg bg-zinc-800 px-3 text-xs font-bold">Nouveau mot de passe</button><button type="button" disabled={Boolean(busy)} onClick={() => setConfirmDisableId(row.headWaiterId)} className="min-h-10 rounded-lg border border-red-500/40 px-3 text-xs font-bold text-red-300">Désactiver</button></>}{row.status === 'disabled' && <button type="button" disabled={Boolean(busy)} onClick={() => void run('enable', row.headWaiterId)} className="min-h-10 rounded-lg bg-zinc-800 px-3 text-xs font-bold">Réactiver</button>}</div></td></tr>)}</tbody></table>
      {!rows.length && busy !== 'list' && <p className="py-5 text-sm text-zinc-400">Aucun chef de rang configuré.</p>}
      {busy === 'list' && <p className="py-5 text-sm text-zinc-400">Chargement des accès…</p>}
    </div>

    {confirmDisableId && <section className="mt-5 border border-red-500/30 bg-red-500/5 p-4" role="alertdialog" aria-labelledby="disable-cdr-title"><h3 id="disable-cdr-title" className="font-black">Désactiver cet accès ?</h3><p className="mt-2 text-sm text-zinc-300">Le CDR ne pourra plus se connecter ni utiliser ses permissions. Son historique et son rattachement sont conservés.</p><div className="mt-4 flex flex-col gap-2 sm:flex-row"><button type="button" disabled={Boolean(busy)} onClick={() => setConfirmDisableId(null)} className="min-h-11 rounded-lg bg-zinc-800 px-4 text-sm font-bold">Annuler</button><button type="button" disabled={Boolean(busy)} onClick={() => void run('disable', confirmDisableId)} className="min-h-11 rounded-lg bg-red-600 px-4 text-sm font-black">Confirmer la désactivation</button></div></section>}
  </section>;
}
