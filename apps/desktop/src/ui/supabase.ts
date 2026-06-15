import { createClient } from '@supabase/supabase-js';

// Publishable key and URL sourced from apps/web/.env.local
// (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).
// The publishable key is public — safe to embed; RLS protects data.
// Override at build time via VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY.
const url =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://oqnqzytctwlptfdvyagl.supabase.co';
const key =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  'sb_publishable_13ONvOzQzo-iNavN0drawA_2YS0RXBw';

// The OS keychain (via Rust/Tauri) is the store of record — not webview
// localStorage. persistSession: false keeps supabase-js from writing tokens
// to localStorage, since we manage persistence ourselves via bridge.storeSession.
export const supabase = createClient(url, key, { auth: { persistSession: false } });
