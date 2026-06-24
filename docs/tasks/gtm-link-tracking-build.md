# Build Ticket — GTM Link Tracking (clean bio redirects + click/signup funnel)

**Created:** 2026-06-23
**Owner:** John
**Context:** `docs/GTM-SPRINT-2026-07-yc-waitlist.md` (35-day YC waitlist sprint).
**Why:** Bios currently point at long `nibbin.com/?utm_...` URLs (ugly on X) and **clicks are
not tracked at all** — only signups are. This builds an owned redirect endpoint that (a) gives
clean bio URLs, (b) logs every click to our own DB, (c) carries UTM through to the signup so we
get click→signup conversion per platform now and per-video later.

**Gate note:** touches `apps/web/app` routes + `supabase/migrations/` — both adversarial-gate
surfaces (AGREEMENTS.md). `main` is PR-protected (4 strict checks). Feature branch → 4 reviewers
→ gate report in `docs/gates/` → PR. Rebase onto the merge target before reviewing.

---

## Outcome (Definition of Done)

- [ ] Bios can use `nibbin.com/r/tt`, `/r/ig`, `/r/x` — clean display, each 302s to the waitlist
      with the correct UTM stamped server-side.
- [ ] Every redirect hit is logged to a `link_hits` table (own DB, no third party).
- [ ] UTM + ref are persisted onto the waitlist signup (`waitlist_joined`) so click → signup is joinable.
- [ ] Admin analytics dashboard (the #205 surface) shows a GTM funnel card: clicks by code,
      signups by source/ref, and click→signup rate.
- [ ] Migration applied + verified on **dev, staging, prod** (information_schema check, not doc-trust — GOTCHAS).
- [ ] Adversarial gate (red-team / claims-auditor / logic-skeptic / cost-auditor) run on the diff,
      report committed to `docs/gates/<date>-gtm-link-tracking.md`, no P0/P1.
- [ ] `npm run lint`, `npm run typecheck`, tests, and `next build` green locally before PR (CI lesson:
      verify all four, not just one; don't trust subagent "passes" claims — check CI).

---

## 1. Migration (`supabase/migrations/`, apply to all 3 DBs)

New migration (next free timestamp after the latest applied).

### `link_hits` — anonymous pre-signup click log
```
link_hits(
  id          uuid pk default gen_random_uuid(),
  code        text not null,                 -- 'tt' | 'ig' | 'x' | future per-video e.g. 'photographer-01'
  occurred_at timestamptz not null default now(),
  referrer    text,
  user_agent  text,
  ip_hash     text,                          -- SHA-256(ip + server-side salt). NEVER store raw IP.
  utm_source  text,
  utm_medium  text,
  utm_campaign text,
  created_at  timestamptz not null default now()
)
```
- **Global / not account-scoped** (these are anonymous clicks, no account exists yet).
- `revoke insert/update/delete from authenticated` — **service-role writes only** (the route uses service role).
- **RLS: no public/authenticated read.** Reads happen via service-role in the admin dashboard query only.
- Index `(code, occurred_at desc)`.
- Bound `code` length in the route (≤64) and store sanitized; `user_agent`/`referrer` bounded (≤1024).

### Waitlist table — add attribution columns
- Add `utm_source text`, `utm_medium text`, `utm_campaign text`, `ref text` to whatever table the
  landing's `waitlist_joined` path writes to. Backward compatible (nullable, no backfill).
- If signups are also recorded as a product event, include the same fields in the event payload.

## 2. Redirect route (`apps/web`)

`app/r/[code]/route.ts` (Route Handler, GET):
1. Read `code` from the path. **Validate:** allowlist or strict sanitize (`^[a-z0-9-]{1,64}$`); reject otherwise with a plain 302 to `/` (no error leak).
2. Derive the platform/UTM from the code:
   - `tt` → `utm_source=tiktok`, `ig` → `utm_source=instagram`, `x` → `utm_source=x`.
   - Unknown-but-valid codes (future per-video) → `utm_source=<code prefix or 'video'>`, `ref=<code>`.
   - `utm_medium=bio`, `utm_campaign=launch` (per-video codes may pass `utm_medium=video`).
3. Insert one `link_hits` row (service role): code, referrer (`req.headers.referer`), user_agent,
   `ip_hash` = SHA-256 of the request IP + a server-side salt env var. Fire-and-forget; **never block
   the redirect on the insert** (log failure to Sentry, still redirect).
4. **302** to `/?utm_source=...&utm_medium=...&utm_campaign=launch&ref=<code>`.

**Security (gate will check):**
- **Open-redirect guard:** the Location is always a fixed own-origin path built from a validated
  code. Never reflect a user-supplied URL/host into the redirect target.
- No PII beyond hashed IP. Salt from env, not committed.
- Rate-limit / cheap-by-construction: a single bounded insert per hit, no fan-out (cost-auditor).

**Clean bare paths (optional polish):** if `nibbin.com/r/x` isn't bare enough, add `next.config`
rewrites mapping `/tt /ig /x` → `/r/tt` etc. Keep `/r/[code]` as the canonical implementation.

## 3. UTM capture on the landing (`apps/web`, `/`)

- On load, read `utm_source/medium/campaign` + `ref` from the query string.
- Persist to a first-party cookie or `sessionStorage` (survives the click→browse→submit gap).
- Attach those values to the **`waitlist_joined` insert** (and the event payload) so the signup row
  carries its source. **This is the step that silently breaks attribution if skipped — add a test
  and verify end-to-end with a real signup through `/r/tt`.**
- No tracking cookies beyond first-party attribution (keep the cookieless/no-consent-banner posture).

## 4. Admin dashboard card (`apps/admin`, extend the #205 analytics surface)

- A "GTM funnel" card: clicks by code (from `link_hits`), signups by `utm_source`/`ref` (from waitlist),
  and **click→signup rate** per source. Service-role/staff-only read, consistent with the existing
  admin analytics access model.
- Keep it simple: a small table + the three platform rows to start; per-video rows appear automatically
  once video codes exist.

## 5. Verification

- RLS test: `link_hits` not readable by anon/authenticated; service-role write works.
- E2E: hit `/r/tt` → one `link_hits` row + 302 with `utm_source=tiktok`; complete a signup →
  waitlist row carries `utm_source=tiktok`, `ref=tt`; dashboard funnel reflects 1 click / 1 signup.
- Open-redirect: a crafted/oversized/invalid `code` cannot redirect off-origin and writes nothing unsafe.
- Regression: existing landing + `waitlist_joined` path unchanged for direct (no-UTM) visits.

## 6. Ship

- Apply migration to dev → staging → prod; verify via information_schema on each.
- Run the 4 adversarial reviewers on the rebased diff; commit `docs/gates/<date>-gtm-link-tracking.md`.
- `npm run lint && npm run typecheck && tests && next build` green locally (workspace-install quirk:
  see `docs/GOTCHAS.md` if `npm ci` misbehaves).
- PR to `main`; pass the 4 CI checks incl. `adversarial-gate`.

---

## After merge (founder action)

Set the three bios to `nibbin.com/r/tt` (TikTok), `nibbin.com/r/ig` (Instagram), `nibbin.com/r/x` (X).
Do one live signup through each and confirm the source shows in the dashboard before relying on it.
For per-video tracking later, just use `nibbin.com/r/<anything>` in that video's bio swap — no new build.
