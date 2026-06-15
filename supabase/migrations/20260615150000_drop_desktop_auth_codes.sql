-- 20260615150000_drop_desktop_auth_codes.sql
-- Security cleanup (2026-06-15): the desktop sign-in code-exchange flow
-- (/api/auth/desktop/issue + /token) was removed on feature/nibbin-desktop-unified-app
-- in favour of native email+password login with the session persisted to the OS
-- keychain and handed to the embedded Grove webview via an init script (never a URL).
-- The `desktop_auth_codes` table backed ONLY those deleted routes and stored full
-- Supabase sessions (access + refresh tokens) in a plaintext jsonb column — it is now
-- orphaned credential-equivalent storage. Drop it. If the code-exchange approach is
-- ever revived, reintroduce it with hashed/short-lived codes, not raw sessions.
drop table if exists public.desktop_auth_codes;
