import type { OperationalActorProfile } from './types';

export function formatActorLabel(profile: OperationalActorProfile | null | undefined) {
  if (!profile) return 'Auteur inconnu';
  const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();
  const role = profile.role === 'hostess' ? 'Hôtesse' : profile.role === 'admin' ? 'Admin' : profile.role;
  return name ? `${name} · ${role}` : role;
}

export const actorProfileMap = (profiles: OperationalActorProfile[]) => new Map(profiles.map((profile) => [profile.id, profile]));
