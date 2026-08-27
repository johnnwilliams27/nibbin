import type { DataSource } from "./data-source.js";
import { FixtureDataSource } from "./fixture-data-source.js";
import { PostgresDataSource } from "./postgres-data-source.js";

let instance: DataSource | null = null;

/** DATA_SOURCE=postgres opts into the (unimplemented) Postgres source; default and only working path is fixtures. */
export function getDataSource(): DataSource {
  if (instance) return instance;
  instance = process.env.DATA_SOURCE === "postgres" ? new PostgresDataSource() : new FixtureDataSource();
  return instance;
}
