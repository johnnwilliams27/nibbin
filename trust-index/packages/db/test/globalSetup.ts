/**
 * Test database lifecycle. Starts a disposable postgres:16 container on a
 * random local port, waits until it accepts connections, and hands the URL to
 * tests via vitest provide/inject. Set TRUST_INDEX_TEST_DB_URL to use an
 * existing database instead (no container is started or removed then).
 */
import { execFileSync } from "node:child_process";
import pg from "pg";
import type { TestProject } from "vitest/node";

const CONTAINER = `trust-index-db-test-${process.pid}`;

function docker(...args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8" }).trim();
}

async function waitForReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    const client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      await client.query("select 1");
      await client.end();
      return;
    } catch (err) {
      lastError = err;
      await client.end().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`test database not ready within ${timeoutMs}ms: ${String(lastError)}`);
}

export default async function setup(project: TestProject): Promise<() => void> {
  const existing = process.env["TRUST_INDEX_TEST_DB_URL"];
  if (existing !== undefined && existing !== "") {
    await waitForReady(existing, 30_000);
    project.provide("dbUrl", existing);
    return () => undefined;
  }

  docker(
    "run",
    "-d",
    "--rm",
    "--name",
    CONTAINER,
    "-e",
    "POSTGRES_PASSWORD=trustindex",
    "-p",
    "127.0.0.1:0:5432",
    "postgres:16",
  );
  const teardown = (): void => {
    try {
      docker("rm", "-f", CONTAINER);
    } catch {
      // Already gone; --rm may have removed it.
    }
  };
  try {
    const mapping = docker("port", CONTAINER, "5432/tcp").split("\n")[0] ?? "";
    const port = mapping.split(":").pop();
    if (port === undefined || port === "") {
      throw new Error(`could not determine mapped port from ${JSON.stringify(mapping)}`);
    }
    const url = `postgres://postgres:trustindex@127.0.0.1:${port}/postgres`;
    await waitForReady(url, 90_000);
    project.provide("dbUrl", url);
  } catch (err) {
    teardown();
    throw err;
  }
  return teardown;
}

declare module "vitest" {
  export interface ProvidedContext {
    dbUrl: string;
  }
}
