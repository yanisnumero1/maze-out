import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const enabled = process.env.RUN_CDR_ACCESS_INTEGRATION === '1';
const localUrl = process.env.SUPABASE_LOCAL_URL ?? '';
const anonKey = process.env.SUPABASE_LOCAL_ANON_KEY ?? '';
const serviceRoleKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ?? '';

describe.skipIf(!enabled)('gestion CDR avec Supabase local', () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const adminEmail = `admin-${suffix}@integration.local`;
  const observerEmail = `observer-${suffix}@integration.local`;
  const cdrUsername = `cdr-${suffix}`.slice(0, 30).replace(/-$/, '');
  const cdrEmail = `${cdrUsername}@cdr.maze-out.local`;
  const initialPassword = 'Admin-test-Password-2026!';
  const ids: { admin?: string; observer?: string; cdr?: string; waiter?: string } = {};
  let adminToken = '';
  let observerToken = '';
  let visitsBefore = 0;

  const service = createClient(localUrl || 'http://127.0.0.1:54321', serviceRoleKey || 'local-placeholder', { auth: { persistSession: false, autoRefreshToken: false } });
  const anonymous = () => createClient(localUrl || 'http://127.0.0.1:54321', anonKey || 'local-placeholder', { auth: { persistSession: false, autoRefreshToken: false } });

  async function invoke(token: string, body: Record<string, unknown>) {
    const request = await fetch(`${localUrl}/functions/v1/manage-cdr-access`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: request.status, body: await request.json() as Record<string, any> };
  }

  beforeAll(async () => {
    const parsed = new URL(localUrl);
    if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) throw new Error('Integration tests refuse every non-local Supabase URL');
    if (!anonKey || !serviceRoleKey) throw new Error('Local Supabase keys are required');

    const [{ data: admin }, { data: observer }] = await Promise.all([
      service.auth.admin.createUser({ email: adminEmail, password: initialPassword, email_confirm: true }),
      service.auth.admin.createUser({ email: observerEmail, password: initialPassword, email_confirm: true }),
    ]);
    if (!admin.user || !observer.user) throw new Error('Unable to create isolated local users');
    ids.admin = admin.user.id;
    ids.observer = observer.user.id;
    await service.from('profiles').update({ role: 'admin', first_name: 'Admin', last_name: 'Integration' }).eq('id', ids.admin);
    const { data: waiter, error: waiterError } = await service.from('head_waiters').insert({ first_name: 'CDR', last_name: `Integration ${suffix}`, active: true }).select('id').single();
    if (waiterError || !waiter) throw waiterError ?? new Error('Unable to create local head waiter');
    ids.waiter = waiter.id;
    const { count } = await service.from('table_visits').select('id', { count: 'exact', head: true });
    visitsBefore = count ?? 0;

    const [{ data: adminSession }, { data: observerSession }] = await Promise.all([
      anonymous().auth.signInWithPassword({ email: adminEmail, password: initialPassword }),
      anonymous().auth.signInWithPassword({ email: observerEmail, password: initialPassword }),
    ]);
    adminToken = adminSession.session?.access_token ?? '';
    observerToken = observerSession.session?.access_token ?? '';
    if (!adminToken || !observerToken) throw new Error('Unable to authenticate isolated local users');
  });

  afterAll(async () => {
    for (const id of [ids.cdr, ids.observer, ids.admin]) if (id) await service.auth.admin.deleteUser(id);
    if (ids.waiter) await service.from('head_waiters').delete().eq('id', ids.waiter);
  });

  it('refuse un non-Admin, crée atomiquement, applique RLS, réinitialise et désactive', async () => {
    const forbidden = await invoke(observerToken, { action: 'list' });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe('admin_required');

    const created = await invoke(adminToken, { action: 'create', headWaiterId: ids.waiter, username: cdrUsername });
    expect(created.status).toBe(200);
    expect(created.body.username).toBe(cdrUsername);
    expect(created.body.temporaryPassword).toBeTypeOf('string');

    const { data: authDirectory } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const cdrUser = authDirectory.users.find((user) => user.email === cdrEmail);
    expect(cdrUser).toBeTruthy();
    ids.cdr = cdrUser!.id;
    const { data: profile } = await service.from('profiles').select('role, head_waiter_id').eq('id', ids.cdr).single();
    expect(profile).toMatchObject({ role: 'cdr', head_waiter_id: ids.waiter });

    const duplicate = await invoke(adminToken, { action: 'create', headWaiterId: ids.waiter, username: `${cdrUsername}x` });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('already_linked');

    const cdrClient = anonymous();
    const signedIn = await cdrClient.auth.signInWithPassword({ email: cdrEmail, password: created.body.temporaryPassword });
    expect(signedIn.error).toBeNull();
    const { data: visibleWaiters } = await cdrClient.from('head_waiters').select('id');
    expect(visibleWaiters).toEqual([{ id: ids.waiter }]);

    const reset = await invoke(adminToken, { action: 'reset_password', headWaiterId: ids.waiter });
    expect(reset.status).toBe(200);
    expect(reset.body.temporaryPassword).not.toBe(created.body.temporaryPassword);
    expect((await anonymous().auth.signInWithPassword({ email: cdrEmail, password: created.body.temporaryPassword })).error).toBeTruthy();
    expect((await anonymous().auth.signInWithPassword({ email: cdrEmail, password: reset.body.temporaryPassword })).error).toBeNull();

    const disabled = await invoke(adminToken, { action: 'disable', headWaiterId: ids.waiter });
    expect(disabled.status).toBe(200);
    expect((await anonymous().auth.signInWithPassword({ email: cdrEmail, password: reset.body.temporaryPassword })).error).toBeTruthy();
    const { data: visibleAfterDisable } = await cdrClient.from('head_waiters').select('id');
    expect(visibleAfterDisable).toEqual([]);
    const { data: preservedWaiter } = await service.from('head_waiters').select('id').eq('id', ids.waiter).single();
    expect(preservedWaiter?.id).toBe(ids.waiter);
    const { count: visitsAfter } = await service.from('table_visits').select('id', { count: 'exact', head: true });
    expect(visitsAfter).toBe(visitsBefore);

    const enabledAgain = await invoke(adminToken, { action: 'enable', headWaiterId: ids.waiter });
    expect(enabledAgain.status).toBe(200);
    expect((await anonymous().auth.signInWithPassword({ email: cdrEmail, password: reset.body.temporaryPassword })).error).toBeNull();
  });
});
