import type { ClubEntryCount, FloorNote, OperationalAuditLog, Promoter, PromoterCountEvent, TableVisit, TableVisitTransfer } from './types';

export type RecapActivity = {
  id: string;
  created_at: string;
  title: string;
  detail?: string | null;
  actorId?: string | null;
};

type ActivityInput = {
  audits: OperationalAuditLog[];
  visits: TableVisit[];
  transfers: TableVisitTransfer[];
  notes: FloorNote[];
  promoterEvents: PromoterCountEvent[];
  promoters: Promoter[];
  entryCounts: ClubEntryCount[];
  tableNumbers: Map<string, number | string>;
};

const auditValue = (audit: OperationalAuditLog, key: string) => audit.after_data?.[key] ?? audit.before_data?.[key] ?? audit.metadata?.[key];
const text = (value: unknown) => typeof value === 'string' ? value : null;
const number = (value: unknown) => typeof value === 'number' ? value : null;

function auditActivity(audit: OperationalAuditLog, input: ActivityInput): RecapActivity | null {
  const table = (id: string | null | undefined) => `Table ${input.tableNumbers.get(id ?? '') ?? '—'}`;
  const visit = input.visits.find((row) => row.id === audit.entity_id);
  const visitTableId = visit?.current_table_id ?? visit?.table_id ?? text(audit.metadata?.current_table_id);
  const transfer = input.transfers.find((row) => row.table_visit_id === audit.entity_id);
  const promoterId = text(auditValue(audit, 'promoter_id'));
  const promoter = input.promoters.find((row) => row.id === promoterId);
  const people = number(auditValue(audit, 'people_added'));
  const count = number(auditValue(audit, 'count'));
  const content = text(auditValue(audit, 'content'));
  const common = { id: `audit-${audit.id}`, created_at: audit.created_at, actorId: audit.actor_id };

  switch (audit.action_type) {
    case 'table.arrival_confirmed': return { ...common, title: `${table(audit.entity_id)} · Arrivée installée` };
    case 'table.sale_ended': return { ...common, title: `${table(audit.entity_id ?? visit?.current_table_id ?? visit?.table_id)} · Vente terminée` };
    case 'table.transferred': return { ...common, title: `${table(transfer?.from_table_id)} → ${table(transfer?.to_table_id)} · Transfert de table` };
    case 'hostess.visit.v4_updated': return { ...common, title: `${table(visitTableId)} · Informations de vente modifiées` };
    case 'cdr.business_referrer.validated': return { ...common, title: `${table(visitTableId)} · Apporteur validé` };
    case 'cdr.business_referrer.corrected': return { ...common, title: `${table(visitTableId)} · Apporteur corrigé` };
    case 'promoter.activity_added': return { ...common, title: `Promoteur ${promoter?.name ?? '—'} · +${people ?? 0} personnes`, detail: text(auditValue(audit, 'note')) };
    case 'promoter.activity_updated': return { ...common, title: `Promoteur ${promoter?.name ?? '—'} · activité corrigée`, detail: text(auditValue(audit, 'note')) };
    case 'promoter.activity_deleted': return { ...common, title: `Promoteur ${promoter?.name ?? '—'} · activité supprimée` };
    case 'floor_note.created': return { ...common, title: 'Note Piste ajoutée', detail: content };
    case 'floor_note.updated': return { ...common, title: 'Note Piste modifiée', detail: content };
    case 'floor_note.deleted': return { ...common, title: 'Note Piste supprimée', detail: content };
    case 'club_entry.created': return { ...common, title: `Entrées club · ${count ?? 0} personnes` };
    case 'club_entry.updated': return { ...common, title: `Entrées club · relevé corrigé à ${count ?? 0}` };
    case 'club_entry.deleted': return { ...common, title: `Entrées club · relevé supprimé (${count ?? 0})` };
    case 'night.closed': return { ...common, title: 'Soirée clôturée' };
    default: return null;
  }
}

/**
 * Audit events win. Older rows are added only when there is no audit for the
 * same business entity, preventing a post-0021 action from being listed twice.
 */
export function recapActivity(input: ActivityInput): RecapActivity[] {
  const auditEvents = input.audits.map((audit) => auditActivity(audit, input)).filter((event): event is RecapActivity => Boolean(event));
  const auditEntities = new Set(input.audits.map((audit) => `${audit.entity_type}:${audit.entity_id ?? ''}`));
  const hasAudit = (entityType: string, entityId: string) => auditEntities.has(`${entityType}:${entityId}`);
  const table = (id: string) => `Table ${input.tableNumbers.get(id) ?? '—'}`;
  const promoterById = new Map(input.promoters.map((promoter) => [promoter.id, promoter]));
  const fallback: RecapActivity[] = [
    ...input.visits.filter((visit) => !hasAudit('table', visit.current_table_id ?? visit.table_id)).map((visit) => ({ id: `visit-${visit.id}`, created_at: visit.arrived_at, title: `${table(visit.current_table_id ?? visit.table_id)} · Arrivée installée` })),
    ...input.transfers.filter((transfer) => !hasAudit('table_visit', transfer.table_visit_id)).map((transfer) => ({ id: `transfer-${transfer.id}`, created_at: transfer.created_at, title: `${table(transfer.from_table_id)} → ${table(transfer.to_table_id)} · Transfert de table`, actorId: transfer.transferred_by })),
    ...input.notes.filter((note) => !hasAudit('floor_note', note.id)).map((note) => ({ id: `note-${note.id}`, created_at: note.created_at, title: 'Note Piste ajoutée', detail: note.content, actorId: note.created_by })),
    ...input.promoterEvents.filter((event) => !hasAudit('promoter_activity', event.id)).map((event) => ({ id: `promoter-${event.id}`, created_at: event.created_at, title: `Promoteur ${promoterById.get(event.promoter_id)?.name ?? '—'} · +${event.people_added ?? 0} personnes`, detail: event.note, actorId: event.changed_by })),
    ...input.entryCounts.filter((entry) => !hasAudit('club_entry', entry.id)).map((entry) => ({ id: `entry-${entry.id}`, created_at: entry.recorded_at, title: `Entrées club · ${entry.count} personnes`, actorId: entry.created_by })),
  ];
  return [...auditEvents, ...fallback].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
}
