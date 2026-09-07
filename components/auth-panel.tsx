'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { cdrUsernameToEmail } from '@/lib/cdr-auth';
import { supabase } from '@/lib/supabase/client';

export function AuthPanel() {
  const router = useRouter();
  const [mode, setMode] = useState<'team' | 'cdr'>('team');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function signIn() {
    setSubmitting(true);
    setNotice('');

    const signInEmail = mode === 'cdr' ? cdrUsernameToEmail(username) : email.trim();
    if (!signInEmail) {
      setNotice('L’identifiant doit contenir uniquement des lettres, chiffres, points, tirets ou underscores.');
      setSubmitting(false);
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email: signInEmail, password });
    if (error || !data.session) {
      console.error('[AUTH] Connexion par mot de passe impossible.', error);
      setNotice(mode === 'cdr' ? 'Identifiant ou mot de passe incorrect.' : 'Adresse e-mail ou mot de passe incorrect.');
      setSubmitting(false);
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.session.user.id)
      .single();

    if (profileError || !['admin', 'hostess', 'cdr'].includes(profile?.role ?? '')) {
      console.error('[AUTH] Profil invalide ou inaccessible après connexion.', profileError);
      await supabase.auth.signOut();
      setNotice('Ce compte ne possède pas les droits requis.');
      setSubmitting(false);
      return;
    }

    router.replace(profile?.role === 'cdr' ? '/cdr' : '/');
  }

  return (
    <form
      className="w-full space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void signIn();
      }}
    >
      <div className="segmented-control grid-cols-2" role="tablist" aria-label="Type de connexion">
        <button type="button" role="tab" aria-selected={mode === 'team'} className={`segmented-option ${mode === 'team' ? 'segmented-option-active' : ''}`} onClick={() => { setMode('team'); setNotice(''); }}>Équipe</button>
        <button type="button" role="tab" aria-selected={mode === 'cdr'} className={`segmented-option ${mode === 'cdr' ? 'segmented-option-active' : ''}`} onClick={() => { setMode('cdr'); setNotice(''); }}>Chef de rang</button>
      </div>
      {mode === 'team' ? <label className="block text-sm font-medium text-zinc-200">
        Adresse e-mail
        <input required type="email" autoComplete="email" className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-zinc-100 outline-none transition focus:border-zinc-400" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label> : <label className="block text-sm font-medium text-zinc-200">
        Identifiant
        <input required type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-zinc-100 outline-none transition focus:border-zinc-400" value={username} onChange={(event) => setUsername(event.target.value.toLocaleLowerCase('fr-FR'))} />
      </label>}
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
        className="primary-button w-full disabled:cursor-wait"
        disabled={submitting}
      >
        {submitting ? 'Connexion en cours...' : 'Se connecter'}
      </button>
      {mode === 'team' && <Link href={'/reset-password' as any} className="block text-center text-sm text-zinc-500 underline underline-offset-4">Mot de passe oublié ?</Link>}
      {notice && <p className="text-center text-sm text-red-300" role="alert">{notice}</p>}
    </form>
  );
}
