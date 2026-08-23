'use client';
import { createClient } from '@supabase/supabase-js';
// Valeurs inertes pour permettre le build avant configuration ; les appels nécessitent .env.local.
export const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-key');
