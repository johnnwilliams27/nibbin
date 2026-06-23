# Task 2 Report — Anthropic client passes image blocks (request-shape test)

**Status:** PASS (verification — tests already present from Task 1 commit)

## Summary

Task 1 (commit `fbf58a5d`) already included both Task 2 tests in
`packages/router/test/anthropic.test.ts` inside the
`content-block union (back-compat + multimodal)` describe block:

1. **Back-compat guard** (`string content serializes byte-identically to the pre-union shape`):
   Asserts `body.messages[0]` equals `{ role: 'user', content: 'draft a reply' }` and
   `typeof body.messages[0].content === 'string'` — no wrapping introduced.

2. **Image-block request-shape lock** (`ContentBlock[] content passes the array through unchanged to the API`):
   Builds a `GenerateRequest` with `content: [{type:'image', source:{type:'base64', media_type:'image/png', data:'AAAA'}}, {type:'text', text:'What does this image show?'}]`;
   asserts `body.messages[0].content` deep-equals the input array, `body.system` has 2 elements,
   and `body.max_tokens === 800`.

Both tests use `fetchImpl` injection — no live API calls.

## Test run

```
npx vitest run packages/router/test/anthropic.test.ts
Test Files  1 passed (1)
      Tests  11 passed (11)
   Duration  402ms
```

All 11 tests green. No additional implementation was needed beyond Task 1.

## Concerns

None. The implementation (pass `m.content` directly — Anthropic natively accepts both
`string` and `ContentBlock[]`) is minimal and correct. Back-compat is proven by test.
