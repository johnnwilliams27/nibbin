import { createClient } from '@supabase/supabase-js';

// Points at the PRODUCTION project (nibbin-prod) — that's where real user
// accounts live (the same backend nibbin.com uses). The dev "Nibbin" project
// has no real accounts, so a distributed desktop build must target prod.
// The publishable key is public — safe to embed; RLS protects data.
// Override per-environment via VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY.
const url =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://oaymttudfazqaqequrke.supabase.co';
const key =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  'sb_publishable_37WSmktUe1J5783qoGGKZA_oSaCgDTV';

// The OS keychain (via Rust/Tauri) is the store of record — not webview
// localStorage. persistSession: false keeps supabase-js from writing tokens
// to localStorage, since we manage persistence ourselves via bridge.storeSession.
export const supabase = createClient(url, key, { auth: { persistSession: false } });
