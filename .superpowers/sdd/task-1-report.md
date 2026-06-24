# Task 1 Report — ConnectorMethod 'N' + validateDescriptor

**Status:** DONE_WITH_CONCERNS
**Date:** 2026-06-23

## Files Changed

- `packages/connectors/src/registry/types.ts` — two edits
- `packages/connectors/test/registry.test.ts` — test additions

## Changes Made

### `types.ts`
1. `ConnectorMethod` broadened: `'A' | 'H' | 'G'` → `'A' | 'H' | 'G' | 'N'`
2. Method validator updated: `['A', 'H', 'G'].includes(d.method)` → `['A', 'H', 'G', 'N'].includes(d.method)`
3. Egress-allowlist error message updated: `'A/H connectors must declare an egress allowlist'` → `'A/H/N connectors must declare an egress allowlist'`

The existing `else` branch (non-empty egress required) already covers `'N'` — no structural change to the egress block was needed. The `'G'` branch (empty required) is untouched. The `scopes.read` check (`d.method !== 'G'`) already correctly requires read scopes for `'N'`.

### `registry.test.ts`
Added at top of file (before the describe block):
- `import type { ConnectorDescriptor }` added to existing import
- `validNDescriptor` constant: a minimal valid method-N descriptor with `egressAllowlist: ['api.example.com']`

Added at end of describe block:
- `'accepts method N with a non-empty egress allowlist'` — expects `validateDescriptor(validNDescriptor)` returns `[]`
- `'rejects method N with empty egress allowlist'` — expects the error array contains a string with 'egress allowlist'

## Test Run Results

```
Tests  19 passed (19)   [registry.test.ts]
Tests  188 passed | 3 skipped (191)   [full packages/connectors suite]
```

Typecheck: green across all packages.

## Concerns

### C1 — Plan's `.toContain(expect.stringContaining(...))` does not work in Vitest for arrays

The plan at Task 1, step 1 specifies:
```ts
expect(validateDescriptor(d)).toContain(expect.stringContaining('egress allowlist'));
```
In Vitest, `Array.toContain()` uses `===` equality and does NOT accept asymmetric matchers for array elements. The test was RED for the wrong reason (matcher mismatch, not logic failure). Fixed by changing to:
```ts
expect(validateDescriptor(d)).toEqual(
  expect.arrayContaining([expect.stringContaining('egress allowlist')]),
);
```
This is a correct TDD adaptation — the intent is identical, only the assertion form differs. Noted here for the plan author.

### C2 — Existing test `'the six §8-M3 hand-built connectors are live [H]'` asserts gmail/google-calendar are still `'H'`

Line 58-64 of registry.test.ts:
```ts
it('the six §8-M3 hand-built connectors are live [H]', () => {
  for (const id of M3_HAND_BUILT) {
    expect(d.method, id).toBe('H');
```
where `M3_HAND_BUILT = ['gmail', 'google-calendar', 'stripe', 'honeybook', 'pixieset', 'instagram-dm']`.

This test currently passes because the registry still has `method: 'H'` for gmail and google-calendar (Task 7 flips these). When Task 7 is implemented, this test will break. Task 7's plan correctly adds a NEW test asserting method = 'N' — but it does not mention removing/updating this existing assertion. The task-7 implementer must either remove gmail/google-calendar from `M3_HAND_BUILT` or update the test description. Flagging so it is not overlooked.

### C3 — `A/H connectors declare egress allowlists` test also covers 'N' automatically

Existing test at line 108:
```ts
it('A/H connectors declare egress allowlists', () => {
  for (const d of listConnectors().filter((d) => d.method !== 'G')) {
```
This filter `d.method !== 'G'` already includes `'N'` connectors, so when Task 7 flips gmail/google-calendar to `'N'`, this test will still correctly enforce the non-empty egress allowlist rule on them. No change needed here — just confirming the invariant will hold.
