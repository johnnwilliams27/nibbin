# Task 1 Report: Router content-block union (types, back-compat)

## Changes

### `packages/router/src/anthropic.ts`
- Added `ContentBlock` type export (union of text block and image/base64 block)
- Widened `ChatTurn.content` from `string` to `string | ContentBlock[]`
- No change to the `messages.map` serialization site (line 129): `content: m.content` already passes the value through unchanged — Anthropic accepts both string and block-array forms natively

### `packages/router/src/index.ts`
- Added `ContentBlock` to the re-export list for `./anthropic`

## Test command and output

```
npx vitest run packages/router/test/anthropic.test.ts
```

```
 RUN  v4.1.8 C:/nib-p2

 Test Files  1 passed (1)
      Tests  11 passed (11)
   Start at  15:52:40
   Duration  410ms (transform 101ms, setup 0ms, import 136ms, tests 45ms, environment 0ms)
```

### TypeScript typecheck (clean)

```
cd C:\nib-p2\packages\router && npx tsc --noEmit
(no output — exit 0)
```

## Pre-implementation failure confirmation

Before the type changes, `npx tsc --noEmit` produced:

```
test/anthropic.test.ts(3,15): error TS2305: Module '"../src/index"' has no exported member 'ContentBlock'.
test/anthropic.test.ts(115,34): error TS2322: Type 'ContentBlock[]' is not assignable to type 'string'.
```

Note: vitest tests themselves passed at runtime before the type fix (since `content: m.content` already passes through any value), but the type-level failure is the authoritative "red" step per the TDD contract for this task (TypeScript strict types are the invariant being added).

## Deviation from plan

None. The implementation is exactly as planned: no logic change at the `messages.map` site — only the type annotation was widened and `ContentBlock` was exported. Existing text-only callers produce a byte-identical request body (proven by the `string content serializes byte-identically` test).
