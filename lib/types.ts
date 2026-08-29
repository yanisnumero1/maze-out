export type TableStatus = 'free' | 'reserved' | 'occupied' | 'light_overload' | 'overload' | 'unavailable';
export type ReservationStatus = 'reserved' | 'arrived' | 'cancelled' | 'no_show' | 'completed';
export type Role = 'admin' | 'hostess' | 'head_waiter' | 'observer';
export interface Zone { id: string; name: string; display_order: number; active: boolean; max_capacity?: number | null }
export interface HeadWaiter { id: string; first_name: string; last_name: string; color: string | null; active: boolean }
export interface NightTable { id: string; number: string; display_number?: number | null; zone_id: string; head_waiter_id: string | null; standard_capacity: number; max_people?: number | null; max_extra_guests?: number | null; status: TableStatus; position_x: number; position_y: number; active: boolean }
export interface Reservation { id: string; table_id: string; client_name: string; reserved_people: number; planned_arrival: string | null; status: ReservationStatus; comment: string | null }
export interface Occupancy { table_id: string; present_people: number; extra_guests: number; comment: string | null; arrived_at: string | null; updated_at: string }
export type LiveTable = NightTable & { zone: Zone; head_waiter: HeadWaiter | null; reservation: Reservation | null; occupancy: Occupancy | null };
export interface NightSession { id: string; started_at: string; ended_at: string | null; created_at: string }
export interface TableVisit { id: string; night_session_id: string; table_id: string; zone_id: string; head_waiter_id: string | null; present_people: number; extra_guests: number; comment: string | null; arrived_at: string; ended_at: string | null; sale_number?: number | null; zone: Zone; head_waiter: HeadWaiter | null }
export interface ArrivalDraft { id: string; table_id: string; actor_id: string; night_session_id: string | null; present_people: number; extra_guests: number; comment: string | null; status: 'draft' | 'confirmed' | 'cancelled'; confirmed_sale_number: number | null; created_at: string; updated_at: string; confirmed_at: string | null }
export interface FloorNote { id: string; night_session_id: string; content: string; created_by: string | null; created_at: string; updated_at: string }
export interface Promoter { id: string; night_session_id: string; name: string; normalized_name: string; entry_count: number; created_by: string | null; created_at: string; updated_at: string }
export interface ClubEntryCount { id: string; night_session_id: string; count: number; recorded_at: string; created_by: string | null; created_at: string; updated_at: string }
export interface Thresholds { lightOverloadFrom: number; overloadFrom: number }
