/** Database client construction. One pool per process; callers own the lifecycle. */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;

export type DbHandle = {
  db: Db;
  pool: pg.Pool;
  close: () => Promise<void>;
};

/** Create a Drizzle handle for the given connection string (DATABASE_URL). */
export function createDb(connectionString: string): DbHandle {
  const pool = new pg.Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
