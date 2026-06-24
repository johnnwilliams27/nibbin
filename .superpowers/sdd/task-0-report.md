# Task 0 Report — Env smoke-test + package installation

**Date:** 2026-06-23
**Branch:** `feature/company-brain-nango`
**Worktree:** `C:\nib-p4`

---

## What was done

1. Installed `@nangohq/node@0.70.8` (exact pin, no `^`) to `packages/connectors/package.json` dependencies using `npm install @nangohq/node@0.70.8 -w packages/connectors`.
2. Created `packages/connectors/test/nango-smoke.test.ts` — skips unless `NANGO_SECRET_KEY` is set; ran as SKIPPED (no key in env).
3. Created `packages/connectors/src/nango-client.ts` — single SDK re-export point (`Nango` class + `ProxyConfiguration` type).
4. Ran `npx vitest run packages/connectors` — 186 tests pass, 3 skipped, 0 failed.

---

## Pinned version

`@nangohq/node`: **`0.70.8`** (exact, no range prefix)

Note: The plan referenced `^0.43.7` but that version does not exist on npm (`0.43.0` is the only `0.43.x` release). The current stable release is `0.70.8`, which is what was installed and pinned.

---

## `proxy()` response shape (confirmed from SDK types)

```
proxy<T = any>(config: ProxyConfiguration): Promise<AxiosResponse<T>>
```

`AxiosResponse<T>` shape (from `axios` transitive dep):
```ts
{
  data: T,           // already-parsed JSON (object) when responseType='json'; raw string when 'text'
  status: number,    // HTTP status code (200, 401, 429, etc.)
  statusText: string,
  headers: RawAxiosResponseHeaders | AxiosResponseHeaders,
  config: InternalAxiosRequestConfig,
  request?: any,
}
```

**Key implication for Task 2 mock:** `res.data` is already parsed JSON (not a raw string) when `responseType: 'json'` (the default and what `NangoConnectorClient.request()` will use). Do NOT call `JSON.parse(res.data)` — call `JSON.stringify(res.data)` to get a string for quarantine. The plan's mock shape `{ status, data, headers }` is correct; no `text()` helper needed on the mock because `NangoConnectorClient.request()` will use `JSON.stringify(res.data)` for `text()`.

---

## `getConnection()` signature (for Task 9 callback)

```ts
getConnection(
  providerConfigKey: string,
  connectionId: string,
  forceRefresh?: boolean,
  refreshToken?: boolean,
  refreshGithubAppJwtToken?: boolean,
): Promise<GetPublicConnection['Success']>
```

The mock in the plan (`getConnectionResult: { credentials: { raw: { scope: string } } }`) needs to match the `GetPublicConnection['Success']` type. Scopes come from `connection.credentials.raw.scope` (a space-separated string for OAuth2 Google connections).

---

## `deleteConnection()` argument order — IMPORTANT

The plan (Task 10) says:
```ts
nango.deleteConnection(conn.nango_connection_id, conn.nango_provider_config_key)
```

But the actual SDK signature is:
```ts
deleteConnection(providerConfigKey: string, connectionId: string): Promise<AxiosResponse<void>>
```

**The argument order is REVERSED from the plan.** Task 10 must call:
```ts
nango.deleteConnection(conn.nango_provider_config_key, conn.nango_connection_id)
```

---

## `NangoProps` constructor note

In v0.70.8, the preferred constructor field is `apiKey`. The `secretKey` field still works as a deprecated alias (TypeScript allows it but it is marked `@deprecated`). The smoke test uses `secretKey` per the plan — this is fine, but Task 6's Nango singleton should use `apiKey` once the env var name is finalized (or rename `NANGO_SECRET_KEY` → `NANGO_API_KEY` in the env docs).

---

## Files created/modified

| File | Action |
|---|---|
| `packages/connectors/package.json` | Added `"@nangohq/node": "0.70.8"` to dependencies |
| `packages/connectors/test/nango-smoke.test.ts` | Created — SDK instantiation smoke test (skip-if-no-key) |
| `packages/connectors/src/nango-client.ts` | Created — SDK re-export point |

---

## Test result

```
Test Files  12 passed | 2 skipped (14)
     Tests  186 passed | 3 skipped (189)
```

All pre-existing tests green. Smoke test skipped (no `NANGO_SECRET_KEY`).
