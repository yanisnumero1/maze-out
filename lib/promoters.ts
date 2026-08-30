import type { Promoter, PromoterCountEvent } from './types';

export interface PromoterActivitySummary {
  promoter: Promoter;
  activities: PromoterCountEvent[];
  lastActivity: PromoterCountEvent | null;
}

const newestFirst = (left: PromoterCountEvent, right: PromoterCountEvent) =>
  new Date(right.created_at).getTime() - new Date(left.created_at).getTime();

/** Only events with people_added are actual arrival activities. Legacy counter edits stay out of this journal. */
export function promoterActivitySummaries(promoters: Promoter[], events: PromoterCountEvent[]): PromoterActivitySummary[] {
  const activitiesByPromoter = new Map<string, PromoterCountEvent[]>();
  for (const event of events) {
    if (event.people_added === null) continue;
    const items = activitiesByPromoter.get(event.promoter_id) ?? [];
    items.push(event);
    activitiesByPromoter.set(event.promoter_id, items);
  }

  return promoters
    .map((promoter) => {
      const activities = [...(activitiesByPromoter.get(promoter.id) ?? [])].sort(newestFirst);
      return { promoter, activities, lastActivity: activities[0] ?? null };
    })
    .sort((left, right) => right.promoter.entry_count - left.promoter.entry_count || left.promoter.name.localeCompare(right.promoter.name, 'fr'));
}

export const promoterArrivalCount = (events: PromoterCountEvent[]) => events.filter((event) => event.people_added !== null).length;
export const promoterActivityTotal = (events: PromoterCountEvent[]) => events.reduce((total, event) => total + (event.people_added ?? 0), 0);
