'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { supabase } from '@/lib/supabase/client';

export function AuthPanel() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function signIn() {
    setSubmitting(true);
    setNotice('');

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      console.error('[AUTH] Connexion par mot de passe impossible.', error);
      setNotice('Adresse e-mail ou mot de passe incorrect.');
      setSubmitting(false);
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.session.user.id)
      .single();

    if (profileError || !['admin', 'hostess'].includes(profile?.role ?? '')) {
      console.error('[AUTH] Profil invalide ou inaccessible après connexion.', profileError);
      await supabase.auth.signOut();
      setNotice('Ce compte ne possède pas les droits requis.');
      setSubmitting(false);
      return;
    }

    router.replace('/');
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
          className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-zinc-100 outline-none transition focus:border-zinc-400"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label className="block text-sm font-medium text-zinc-200">
        Mot de passe
        <input
          required
          type="password"
          autoComplete="current-password"
          className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-zinc-100 outline-none transition focus:border-zinc-400"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <button
        className="w-full rounded-xl bg-white px-4 py-3 font-bold text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-wait disabled:opacity-70"
        disabled={submitting}
      >
        {submitting ? 'Connexion en cours...' : 'Se connecter'}
      </button>
      <Link href={'/reset-password' as any} className="block text-center text-sm text-zinc-500 underline underline-offset-4">Mot de passe oublié ?</Link>
      {notice && <p className="text-center text-sm text-red-300" role="alert">{notice}</p>}
    </form>
  );
}
