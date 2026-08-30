import type { OperationalActorProfile, OperationalAuditLog } from './types';

export function formatActorLabel(profile: OperationalActorProfile | null | undefined) {
  if (!profile) return 'Auteur inconnu';
  const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();
  const role = profile.role === 'hostess' ? 'Hôtesse' : profile.role === 'admin' ? 'Admin' : profile.role;
  return name ? `${name} · ${role}` : role;
}

export const actorProfileMap = (profiles: OperationalActorProfile[]) => new Map(profiles.map((profile) => [profile.id, profile]));

/** The audit is ordered newest first by every operational screen. */
export function latestAuditActor(
  audits: OperationalAuditLog[],
  entityType: string,
  entityId: string | null | undefined,
  actionTypes?: string[],
) {
  if (!entityId) return null;
  return audits.find((audit) => audit.entity_type === entityType
    && audit.entity_id === entityId
    && (!actionTypes || actionTypes.includes(audit.action_type)))?.actor_id ?? null;
}

export function actorIdsForResolution(...ids: Array<string | null | undefined>) {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}
