'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase/client';

export function AuthPanel() {
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function signIn() {
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setNotice(error ? error.message : 'Un lien sécurisé vous a été envoyé par e-mail.');
    setSubmitting(false);
  }

  return (
    <form
      className="w-full space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void signIn();
      }}
    >
      <label className="block text-sm font-medium text-zinc-200">
        Adresse e-mail
        <input
          required
          type="email"
          autoComplete="email"
          placeholder="email@etablissement.fr"
          className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-zinc-100 outline-none transition focus:border-zinc-400"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <button
        className="w-full rounded-xl bg-white px-4 py-3 font-bold text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-wait disabled:opacity-70"
        disabled={submitting}
      >
        {submitting ? 'Envoi en cours...' : 'Recevoir un lien de connexion'}
      </button>
      <p className="text-center text-sm text-zinc-500">Un lien sécurisé vous sera envoyé par e-mail.</p>
      {notice && <p className="text-center text-sm text-zinc-300" role="status">{notice}</p>}
    </form>
  );
}
