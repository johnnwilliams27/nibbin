/**
 * RLS attack-test harness. Connects to a throwaway Postgres (CI service
 * container or local Docker), installs the Supabase stub, applies the
 * in-repo migrations, and provides per-identity query helpers.
 *
 * The database is wiped (public/auth/private schemas dropped) on every
 * setup — never point this at anything but a disposable instance.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');

export const DATABASE_URL =
  process.env.RLS_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:54329/postgres';

export type Identity =
  | { kind: 'anon' }
  | { kind: 'authenticated'; uid: string }
  | { kind: 'service_role' };

export class RlsHarness {
  readonly pool: pg.Pool;

  constructor() {
    this.pool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  }

  /** True when the database is reachable. CI must never skip on this. */
  static async probe(): Promise<boolean> {
    const pool = new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 3000 });
    try {
      await pool.query('select 1');
      return true;
    } catch {
      return false;
    } finally {
      await pool.end();
    }
  }

  /** Wipe, install the Supabase stub, then apply every in-repo migration in order. */
  async reset(): Promise<void> {
    await this.pool.query('drop schema if exists public cascade');
    await this.pool.query('drop schema if exists auth cascade');
    await this.pool.query('drop schema if exists private cascade');
    await this.pool.query('create schema public');
    await this.pool.query('grant all on schema public to postgres');

    const stub = await readFile(join(ROOT, 'tests', 'rls', 'supabase-stub.sql'), 'utf8');
    await this.pool.query(stub);

    let files: string[] = [];
    try {
      files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    } catch {
      // no migrations directory yet — tables simply won't exist
    }
    for (const f of files) {
      const sql = await readFile(join(MIGRATIONS_DIR, f), 'utf8');
      try {
        await this.pool.query(sql);
      } catch (e) {
        throw new Error(`migration ${f} failed: ${(e as Error).message}`);
      }
    }
  }

  /**
   * Run queries as a given identity inside one transaction (committed unless
   * the callback throws). `set local role` + the request.jwt.claims GUC is
   * exactly how PostgREST/Supabase establishes the querying identity.
   */
  async as<T>(identity: Identity, fn: (client: pg.ClientBase) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      if (identity.kind === 'authenticated') {
        await client.query(
          `select set_config('request.jwt.claims', $1, true)`,
          [JSON.stringify({ sub: identity.uid, role: 'authenticated' })],
        );
        await client.query('set local role authenticated');
      } else if (identity.kind === 'anon') {
        await client.query('set local role anon');
      } else {
        await client.query('set local role service_role');
      }
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  /** Superuser query (seeding auth.users, structural assertions). */
  async sql(text: string, params?: unknown[]): Promise<pg.QueryResult> {
    return this.pool.query(text, params);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
