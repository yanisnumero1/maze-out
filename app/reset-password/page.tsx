'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

export default function ResetPasswordPage() {
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [mode, setMode] = useState<'request' | 'update'>('request');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const recoveryInUrl = window.location.hash.includes('type=recovery') || window.location.search.includes('type=recovery');
    if (recoveryInUrl) setMode('update');

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setMode('update');
    });

    return () => subscription.unsubscribe();
  }, []);

  async function requestReset() {
    setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      console.error('[AUTH] Réinitialisation impossible.', error);
      setNotice('Impossible d’envoyer le lien de réinitialisation. Réessayez.');
    } else {
      setNotice('Si ce compte existe, un e-mail de réinitialisation a été envoyé.');
    }
    setSubmitting(false);
  }

  async function updatePassword() {
    if (newPassword.length < 8) return setNotice('Le mot de passe doit contenir au moins 8 caractères.');
    if (newPassword !== confirmation) return setNotice('Les mots de passe ne correspondent pas.');
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      console.error('[AUTH] Mise à jour du mot de passe impossible.', error);
      setNotice('Impossible de mettre à jour le mot de passe. Ouvrez à nouveau le lien reçu.');
    } else {
      setNotice('Mot de passe mis à jour. Vous pouvez maintenant vous connecter.');
    }
    setSubmitting(false);
  }

  return (
    <section className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-sm items-center">
      <div className="w-full">
        <Image src="/bridge-logo.svg" alt="BRIDGE — Pont Alexandre III" width={480} height={112} priority className="mx-auto mb-12 w-64" />
        <div className="panel p-6 sm:p-8">
          <h1 className="text-xl font-bold">Mot de passe oublié</h1>
          {mode === 'request' ? <form className="mt-6 space-y-4" onSubmit={(event) => { event.preventDefault(); void requestReset(); }}>
            <label className="block text-sm font-medium text-zinc-200">Adresse e-mail<input required type="email" autoComplete="email" className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-zinc-100" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <button className="w-full rounded-xl bg-white px-4 py-3 font-bold text-zinc-950" disabled={submitting}>{submitting ? 'Envoi en cours...' : 'Envoyer le lien de réinitialisation'}</button>
          </form> : <form className="mt-6 space-y-4" onSubmit={(event) => { event.preventDefault(); void updatePassword(); }}>
            <label className="block text-sm font-medium text-zinc-200">Nouveau mot de passe<input required type="password" autoComplete="new-password" className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-zinc-100" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
            <label className="block text-sm font-medium text-zinc-200">Confirmer le mot de passe<input required type="password" autoComplete="new-password" className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-zinc-100" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
            <button className="w-full rounded-xl bg-white px-4 py-3 font-bold text-zinc-950" disabled={submitting}>{submitting ? 'Mise à jour...' : 'Définir le mot de passe'}</button>
          </form>}
          <p className="mt-4 text-center text-sm text-zinc-500">{notice}</p>
          <Link href={'/login' as any} className="mt-5 block text-center text-sm text-zinc-400 underline underline-offset-4">Retour à la connexion</Link>
        </div>
      </div>
    </section>
  );
}
