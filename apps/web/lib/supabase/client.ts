'use client';

import { createBrowserClient } from '@supabase/ssr';
import { getSupabaseUrl, getSupabasePublishableKey } from './env';

/** Browser Supabase client (publishable key; RLS-scoped to the signed-in user). */
export function createClient() {
  return createBrowserClient(getSupabaseUrl(), getSupabasePublishableKey());
}
