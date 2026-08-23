import { z } from 'zod';
export const occupancySchema = z.object({ present_people: z.number().int().min(0).max(50), extra_guests: z.number().int().min(0).max(50), comment: z.string().max(500).nullable().optional() });
