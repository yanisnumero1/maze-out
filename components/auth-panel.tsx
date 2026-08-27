'use client';

import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

export function AuthPanel() {
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState('');
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.error('[AUTH] Impossible de récupérer la session existante.', error);
      }

      if (mounted) {
        setSession(data.session);
        setAuthReady(true);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      console.info('[AUTH] Changement de session.', { event, hasSession: Boolean(nextSession) });
      if (mounted) {
        setSession(nextSession);
        setAuthReady(true);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Never flash the sign-in form while a persisted session is being restored.
  if (!authReady || session) {
    return null;
  }

  async function signIn() {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });

    setNotice(error ? error.message : 'Lien de connexion envoyé.');
  }

  return (
    <form
      className="panel mb-5 flex flex-wrap items-center gap-2 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void signIn();
      }}
    >
      <span className="text-sm text-zinc-400">Accès sécurisé</span>
      <input
        required
        type="email"
        placeholder="email@etablissement.fr"
        className="min-w-52 flex-1 rounded-lg bg-zinc-800 px-3 py-2"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <button className="rounded-lg bg-zinc-700 px-4 py-2 text-sm font-semibold">Recevoir un lien</button>
      {notice && <span className="text-xs text-zinc-400">{notice}</span>}
    </form>
  );
}
