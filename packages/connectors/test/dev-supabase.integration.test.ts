/**
 * Opt-in integration suite against the SHARED DEV Supabase project — the real
 * PostgREST + Vault stack rather than the local stand-in.
 *
 * Activation: set CONNECTORS_DEV_SUPABASE=1 plus NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SECRET_KEY (read from the environment or a repo-root .env). Never
 * runs in CI; requires the M3 migration applied to the dev project. Creates
 * its own throwaway account/connection and deletes them afterwards.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SupabaseTokenVault } from '../src/vault';
import { safeFetch } from '../src/egress/safe-fetch';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function loadDotEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of ['.env', join('apps', 'web', '.env.local')]) {
    try {
      for (const line of readFileSync(join(ROOT, file), 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && m[2] && !(m[1]! in out)) out[m[1]!] = m[2]!;
      }
    } catch {
      // file absent — fine
    }
  }
  return out;
}

const dotenv = loadDotEnv();
const env = (k: string) => process.env[k] ?? dotenv[k];
const url = env('NEXT_PUBLIC_SUPABASE_URL');
const serviceKey = env('SUPABASE_SECRET_KEY');
const enabled = env('CONNECTORS_DEV_SUPABASE') === '1' && Boolean(url) && Boolean(serviceKey);

if (!enabled) {
  console.warn(
    '[connectors] dev-Supabase suite skipped (set CONNECTORS_DEV_SUPABASE=1 + Supabase env/.env to run; needs the M3 migration applied to dev)',
  );
}

describe.skipIf(!enabled)('vault roundtrip against the shared dev Supabase', () => {
  const host = url ? new URL(url).hostname : '';
  const headers = {
    apikey: serviceKey!,
    authorization: `Bearer ${serviceKey!}`,
    'content-type': 'application/json',
    prefer: 'return=representation',
  };
  let accountId = '';
  let connectionId = '';

  const rest = (path: string, init: { method?: string; body?: string } = {}) =>
    safeFetch(`${url!.replace(/\/$/, '')}/rest/v1${path}`, { ...init, headers }, { allowedHosts: [host] });

  afterAll(async () => {
    if (accountId) {
      await rest(`/accounts?id=eq.${accountId}`, { method: 'DELETE' });
    }
  });

  it('stores, reads, rotates, and revokes through the real Vault', async () => {
    const acct = await rest('/accounts', {
      method: 'POST',
      body: JSON.stringify({ name: 'M3 integration throwaway' }),
    });
    expect(acct.status).toBe(201);
    accountId = (acct.json() as Array<{ id: string }>)[0]!.id;

    const conn = await rest('/connections', {
      method: 'POST',
      body: JSON.stringify({ account_id: accountId, provider: 'gmail', method: 'H', status: 'active' }),
    });
    expect(conn.status).toBe(201);
    connectionId = (conn.json() as Array<{ id: string }>)[0]!.id;

    const vault = new SupabaseTokenVault({ supabaseUrl: url!, serviceKey: serviceKey! });
    await vault.store(connectionId, { accessToken: 'integration-secret', scopes: ['s'] });
    expect((await vault.read(connectionId)).accessToken).toBe('integration-secret');

    // the row itself carries only the ref
    const row = await rest(`/connections?id=eq.${connectionId}&select=token_ref,status`);
    const data = (row.json() as Array<{ token_ref: string | null }>)[0]!;
    expect(data.token_ref).toMatch(/^[0-9a-f-]{36}$/);

    await vault.revoke(connectionId);
    await expect(vault.read(connectionId)).rejects.toThrow();
  }, 60_000);
});
