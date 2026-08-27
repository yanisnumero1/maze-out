export type TableStatus = 'free' | 'reserved' | 'occupied' | 'light_overload' | 'overload' | 'unavailable';
export type ReservationStatus = 'reserved' | 'arrived' | 'cancelled' | 'no_show';
export type Role = 'admin' | 'hostess' | 'head_waiter' | 'observer';
export interface Zone { id: string; name: string; display_order: number; active: boolean }
export interface HeadWaiter { id: string; first_name: string; last_name: string; color: string | null; active: boolean }
export interface NightTable { id: string; number: string; zone_id: string; head_waiter_id: string | null; standard_capacity: number; status: TableStatus; position_x: number; position_y: number; active: boolean }
export interface Reservation { id: string; table_id: string; client_name: string; reserved_people: number; planned_arrival: string | null; status: ReservationStatus; comment: string | null }
export interface Occupancy { table_id: string; present_people: number; extra_guests: number; comment: string | null; arrived_at: string | null; updated_at: string }
export type LiveTable = NightTable & { zone: Zone; head_waiter: HeadWaiter | null; reservation: Reservation | null; occupancy: Occupancy | null };
export interface NightSession { id: string; started_at: string; ended_at: string | null; created_at: string }
export interface TableVisit { id: string; night_session_id: string; table_id: string; zone_id: string; head_waiter_id: string | null; present_people: number; extra_guests: number; comment: string | null; arrived_at: string; ended_at: string | null; zone: Zone; head_waiter: HeadWaiter | null }
export interface Thresholds { lightOverloadFrom: number; overloadFrom: number }
