# Task 7 Report — Registry: gmail + google-calendar method H → N

**Date:** 2026-06-23
**Branch:** `feature/company-brain-nango`
**Status:** COMPLETE

---

## Changes Made

### `packages/connectors/src/registry/registry.ts`
- `gmail` descriptor: `method: 'H'` → `method: 'N'`
- `google-calendar` descriptor: `method: 'H'` → `method: 'N'`
- Stripe descriptor: `method: 'H'` — untouched (deferred, no Stripe OAuth app)
- No other fields touched (scopes, allowlists, webhooks, scanModules, capabilities all unchanged)

### `packages/connectors/test/registry.test.ts`
- Removed `M3_HAND_BUILT` constant (`['gmail', 'google-calendar', 'stripe', 'honeybook', 'pixieset', 'instagram-dm']`)
- Replaced with two constants:
  - `M3_HAND_BUILT_H = ['stripe', 'honeybook', 'pixieset', 'instagram-dm']` — remain `'H'`
  - `M3_NANGO = ['gmail', 'google-calendar']` — now `'N'`
- Updated existing test `'the six §8-M3 hand-built connectors are live [H]'` → `'the four §8-M3 remaining hand-built connectors are live [H]'` (asserts `M3_HAND_BUILT_H`)
- Added new test `'gmail and google-calendar use method N (Task 7)'` — asserts both are `'N'` and `'live'`
- Added new test `'stripe stays method H (Nango migration deferred — no Stripe OAuth app)'` — asserts `stripe.method === 'H'`

---

## TDD Flow

1. Updated test file first (constants + 2 new assertions) — 1 test RED (`gmail and google-calendar use method N`)
2. Flipped `method: 'H'` → `method: 'N'` on both descriptors in registry.ts
3. All 22 registry tests GREEN

---

## Test Results

| Suite | Result |
|---|---|
| `registry.test.ts` | 22/22 passed |
| Full `packages/connectors` | 217 passed, 3 skipped (integration/smoke), 0 failed |
| `npm run typecheck` | Exit 0, no errors |
| `npm run lint` | Exit 0, no errors |

### Key assertions now in the test suite
- `gmail.method === 'N'` ✓
- `google-calendar.method === 'N'` ✓
- `stripe.method === 'H'` ✓
- `honeybook.method === 'H'` ✓ (via M3_HAND_BUILT_H)
- `pixieset.method === 'H'` ✓ (via M3_HAND_BUILT_H)
- `instagram-dm.method === 'H'` ✓ (via M3_HAND_BUILT_H)
- `'A/H/N connectors declare egress allowlists'` — the `method !== 'G'` filter now naturally includes `'N'`; gmail and google-calendar both have non-empty allowlists, so this test still passes ✓

---

## Concerns / Notes

- None. The `validateDescriptor` egress-allowlist check (Task 1) already covered `'N'` methods requiring a non-empty allowlist, so gmail and google-calendar pass the invariant check without any changes to the validator.
- The `'OAuth endpoints sit inside their connector egress allowlist'` test passes because gmail + google-calendar still have `GOOGLE_AUTH_HOSTS` in their allowlists — their OAuth endpoints are unchanged.
- `csv-import` is not in TIER1_CATALOG but is in the registry — this is a pre-existing condition, not introduced by Task 7.
