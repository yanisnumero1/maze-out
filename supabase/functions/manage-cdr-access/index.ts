import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';
import {
  cdrUsernameToEmail,
  generateTemporaryPassword,
  isSecureTemporaryPassword,
  technicalEmailToCdrUsername,
} from '../_shared/cdr-access.ts';

type Action = 'list' | 'create' | 'reset_password' | 'disable' | 'enable';
type RequestBody = { action?: Action; headWaiterId?: string; username?: string };
type Profile = { id: string; role: string; head_waiter_id: string | null; cdr_access_disabled_at: string | null };

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function serviceKey(): string | undefined {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY');
  if (legacy) return legacy;
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (!keys) return undefined;
  try { return JSON.parse(keys).default; } catch { return undefined; }
}

function response(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function failure(status: number, code: string): Response {
  return response(status, { ok: false, code });
}

async function findUserByEmail(client: SupabaseClient, email: string): Promise<User | null> {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLocaleLowerCase('fr-FR') === email);
    if (found) return found;
    if (data.users.length < 1000) return null;
  }
  throw new Error('User directory pagination limit reached');
}

async function profileForHeadWaiter(client: SupabaseClient, headWaiterId: string): Promise<Profile | null> {
  const { data, error } = await client
    .from('profiles')
    .select('id, role, head_waiter_id, cdr_access_disabled_at')
    .eq('head_waiter_id', headWaiterId);
  if (error) throw error;
  if ((data ?? []).length !== 1 || data![0].role !== 'cdr') return null;
  return data![0] as Profile;
}

async function writeAudit(client: SupabaseClient, actorId: string, headWaiterId: string, actionType: string, metadata?: Record<string, unknown>) {
  const { error } = await client.from('operational_audit_log').insert({
    night_session_id: null,
    actor_id: actorId,
    action_type: actionType,
    entity_type: 'head_waiter_access',
    entity_id: headWaiterId,
    metadata: metadata ?? null,
  });
  if (error) throw error;
}

async function listAccesses(client: SupabaseClient): Promise<Response> {
  const [{ data: headWaiters, error: waiterError }, { data: profiles, error: profileError }] = await Promise.all([
    client.from('head_waiters').select('id, first_name, last_name, active').order('first_name').order('last_name'),
    client.from('profiles').select('id, role, head_waiter_id, cdr_access_disabled_at').not('head_waiter_id', 'is', null),
  ]);
  if (waiterError || profileError) throw waiterError ?? profileError;

  const allLinkedProfiles = (profiles ?? []) as Profile[];
  const cdrProfiles = allLinkedProfiles.filter((profile) => profile.role === 'cdr');
  const authUsers = new Map<string, User | null>();
  await Promise.all(cdrProfiles.map(async (profile) => {
    const { data, error } = await client.auth.admin.getUserById(profile.id);
    authUsers.set(profile.id, error ? null : data.user);
  }));

  const rows = (headWaiters ?? []).map((waiter) => {
    const linked = allLinkedProfiles.filter((profile) => profile.head_waiter_id === waiter.id);
    const profile = linked[0];
    const user = profile?.role === 'cdr' ? authUsers.get(profile.id) : null;
    const username = user ? technicalEmailToCdrUsername(user.email) : null;
    const authIsBanned = Boolean(user?.banned_until && new Date(user.banned_until).getTime() > Date.now());
    const profileIsDisabled = Boolean(profile?.cdr_access_disabled_at);
    const status = linked.length > 1 || (profile && (profile.role !== 'cdr' || !user || !username || authIsBanned !== profileIsDisabled)) ? 'inconsistent'
      : profileIsDisabled ? 'disabled'
        : profile ? 'active'
          : 'none';
    return {
      headWaiterId: waiter.id,
      firstName: waiter.first_name,
      lastName: waiter.last_name,
      active: waiter.active,
      username,
      status,
    };
  });
  return response(200, { ok: true, rows });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { ...JSON_HEADERS, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
  }
  if (request.method !== 'POST') return failure(405, 'invalid_request');

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const key = serviceKey();
  const authorization = request.headers.get('authorization');
  if (!url || !anonKey || !key) return failure(500, 'server_configuration');
  if (!authorization?.startsWith('Bearer ')) return failure(401, 'authentication_required');

  const token = authorization.slice('Bearer '.length);
  const callerClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const service = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: callerData, error: callerError } = await callerClient.auth.getUser(token);
  if (callerError || !callerData.user) return failure(401, 'authentication_required');

  const { data: callerProfile, error: callerProfileError } = await service
    .from('profiles')
    .select('role')
    .eq('id', callerData.user.id)
    .single();
  if (callerProfileError || callerProfile?.role !== 'admin') return failure(403, 'admin_required');

  let body: RequestBody;
  try { body = await request.json(); } catch { return failure(400, 'invalid_request'); }
  if (!body.action || !['list', 'create', 'reset_password', 'disable', 'enable'].includes(body.action)) return failure(400, 'invalid_request');

  try {
    if (body.action === 'list') return await listAccesses(service);
    if (!body.headWaiterId || !UUID_PATTERN.test(body.headWaiterId)) return failure(400, 'invalid_request');

    const { data: waiter, error: waiterError } = await service
      .from('head_waiters')
      .select('id, first_name, last_name')
      .eq('id', body.headWaiterId)
      .maybeSingle();
    if (waiterError) throw waiterError;
    if (!waiter) return failure(404, 'head_waiter_not_found');

    if (body.action === 'create') {
      const email = cdrUsernameToEmail(body.username ?? '');
      if (!email) return failure(400, 'invalid_username');
      const { data: linkedProfiles, error: linkedError } = await service.from('profiles').select('id, role').eq('head_waiter_id', waiter.id);
      if (linkedError) throw linkedError;
      if ((linkedProfiles ?? []).length > 1 || linkedProfiles?.some((profile) => profile.role !== 'cdr')) return failure(409, 'inconsistent_profile');
      if ((linkedProfiles ?? []).length === 1) return failure(409, 'already_linked');
      if (await findUserByEmail(service, email)) return failure(409, 'username_taken');

      const temporaryPassword = generateTemporaryPassword();
      if (!isSecureTemporaryPassword(temporaryPassword)) throw new Error('Password generator invariant failed');
      const { data: created, error: createError } = await service.auth.admin.createUser({
        email,
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: { first_name: waiter.first_name, last_name: waiter.last_name },
      });
      if (createError || !created.user) return failure(409, createError?.message.toLowerCase().includes('already') ? 'username_taken' : 'creation_failed');

      const { data: updatedProfile, error: profileUpdateError } = await service.from('profiles').update({
        role: 'cdr',
        first_name: waiter.first_name,
        last_name: waiter.last_name,
        head_waiter_id: waiter.id,
        cdr_access_disabled_at: null,
      }).eq('id', created.user.id).select('id').maybeSingle();
      if (profileUpdateError || !updatedProfile) {
        await service.auth.admin.deleteUser(created.user.id);
        return failure(409, profileUpdateError?.code === '23505' ? 'already_linked' : 'inconsistent_profile');
      }
      try {
        await writeAudit(service, callerData.user.id, waiter.id, 'cdr.access.created', { username: technicalEmailToCdrUsername(email) });
      } catch {
        await service.auth.admin.deleteUser(created.user.id);
        return failure(500, 'audit_failed');
      }
      return response(200, { ok: true, username: technicalEmailToCdrUsername(email), temporaryPassword });
    }

    const profile = await profileForHeadWaiter(service, waiter.id);
    if (!profile) return failure(409, 'inconsistent_profile');
    const { data: authData, error: authError } = await service.auth.admin.getUserById(profile.id);
    if (authError || !authData.user) return failure(409, 'auth_user_missing');
    const username = technicalEmailToCdrUsername(authData.user.email);
    if (!username) return failure(409, 'inconsistent_profile');

    if (body.action === 'reset_password') {
      const temporaryPassword = generateTemporaryPassword();
      const { error } = await service.auth.admin.updateUserById(profile.id, { password: temporaryPassword });
      if (error) return failure(500, 'password_reset_failed');
      let warning: string | undefined;
      try { await writeAudit(service, callerData.user.id, waiter.id, 'cdr.access.password_reset', { username }); } catch { warning = 'audit_failed'; }
      return response(200, { ok: true, username, temporaryPassword, warning });
    }

    const disabling = body.action === 'disable';
    if (disabling && profile.cdr_access_disabled_at) return response(200, { ok: true, username });
    if (!disabling && !profile.cdr_access_disabled_at) return response(200, { ok: true, username });

    const { error: authUpdateError } = await service.auth.admin.updateUserById(profile.id, { ban_duration: disabling ? '876000h' : 'none' });
    if (authUpdateError) return failure(500, disabling ? 'disable_failed' : 'enable_failed');
    const { error: profileUpdateError } = await service.from('profiles').update({ cdr_access_disabled_at: disabling ? new Date().toISOString() : null }).eq('id', profile.id);
    if (profileUpdateError) {
      await service.auth.admin.updateUserById(profile.id, { ban_duration: disabling ? 'none' : '876000h' });
      return failure(500, 'inconsistent_profile');
    }
    let warning: string | undefined;
    try { await writeAudit(service, callerData.user.id, waiter.id, disabling ? 'cdr.access.disabled' : 'cdr.access.enabled', { username }); } catch { warning = 'audit_failed'; }
    return response(200, { ok: true, username, warning });
  } catch {
    return failure(500, 'server_error');
  }
});
