import { createServerClient } from '@supabase/ssr';
import { type NextRequest } from 'next/server';
import { createClient } from '../supabase/server';
import { getSupabaseUrl, getSupabasePublishableKey } from '../supabase/env';

/**
 * Desktop callers carry no cookies — they authenticate via
 * `Authorization: Bearer <supabase-access-token>`.  This helper returns a
 * token-bound Supabase client when a Bearer JWT is present, falling back to
 * the normal cookie-based session client for web callers.
 */
export async function clientForRequest(req: NextRequest) {
  const bearer = req.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9._-]+)$/)?.[1];
  if (bearer) {
    return createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
      cookies: { getAll: () => [], setAll: () => {} },
    });
  }
  return createClient();
}
