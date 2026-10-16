import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const enabled = process.env.RUN_CDR_ACCESS_INTEGRATION === '1';
const localUrl = process.env.SUPABASE_LOCAL_URL ?? '';
const anonKey = process.env.SUPABASE_LOCAL_ANON_KEY ?? '';
const serviceKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ?? '';

describe.skipIf(!enabled)('privileged function access on local Supabase', () => {
  const ids: string[] = [];
  const clients: Record<string, SupabaseClient> = {};
  const makeClient = (key = anonKey) => createClient(localUrl || 'http://127.0.0.1:54321', key || 'local-placeholder', {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let service: SupabaseClient;

  beforeAll(async () => {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(localUrl).hostname)) {
      throw new Error('Security integration tests refuse every non-local Supabase URL');
    }
    if (!anonKey || !serviceKey) throw new Error('Local Supabase keys are required');
    service = makeClient(serviceKey);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    for (const role of ['admin', 'hostess', 'observer', 'missing']) {
      const email = `rpc-${role}-${suffix}@integration.local`;
      const password = 'Local-RPC-Test-2026!';
      const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw error ?? new Error('Unable to create local user');
      ids.push(data.user.id);
      const result = role === 'missing'
        ? await service.from('profiles').delete().eq('id', data.user.id)
        : await service.from('profiles').update({ role }).eq('id', data.user.id);
      if (result.error) throw result.error;
      const client = makeClient();
      const signedIn = await client.auth.signInWithPassword({ email, password });
      if (signedIn.error) throw signedIn.error;
      clients[role] = client;
    }
  }, 30_000);

  afterAll(async () => {
    for (const id of ids) {
      const { error } = await service.auth.admin.deleteUser(id);
      if (error) throw error;
    }
  });

  it('denies anonymous execution of operational RPCs', async () => {
    for (const name of ['open_night_session', 'close_current_night_session', 'assert_operational_role']) {
      const { error } = await makeClient().rpc(name);
      expect(error?.code, name).toBe('42501');
    }
  });

  it('rejects authenticated users without a profile before business operations', async () => {
    for (const [name, args] of [
      ['open_night_session', {}],
      ['assert_operational_role', {}],
      ['release_operational_table', { p_table_id: '00000000-0000-0000-0000-000000000000' }],
      ['close_current_night_session', {}],
    ] as const) {
      const { error } = await clients.missing.rpc(name, args);
      expect(error?.code, name).toBe('42501');
    }
  });

  it('preserves the observer role restriction', async () => {
    const { error } = await clients.observer.rpc('assert_operational_role');
    expect(error?.message).toBe('Operational access required');
  });

  it.each(['admin', 'hostess'])('preserves operational authorization for %s', async (role) => {
    const { error } = await clients[role].rpc('assert_operational_role');
    expect(error).toBeNull();
  });
});
