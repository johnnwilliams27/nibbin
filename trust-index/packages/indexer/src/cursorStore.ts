/**
 * Per-(chain, contract) backfill/poll cursor persistence (SPEC 10.1, 10.5).
 * The production implementation is @trust-index/db's createPgCursorStore;
 * this package only depends on the interface (pinned structurally against
 * the db package in pgCompat.ts) plus an in-memory implementation for tests.
 */

export type Cursor = {
  lastProcessedBlock: number;
  lastProcessedHash: string | null;
};

export interface CursorStore {
  get(chainId: number, contract: string): Promise<Cursor | null>;
  set(chainId: number, contract: string, cursor: Cursor): Promise<void>;
}

export function createInMemoryCursorStore(): CursorStore {
  const store = new Map<string, Cursor>();
  const key = (chainId: number, contract: string): string => `${chainId}:${contract}`;
  return {
    async get(chainId, contract) {
      return store.get(key(chainId, contract)) ?? null;
    },
    async set(chainId, contract, cursor) {
      store.set(key(chainId, contract), cursor);
    },
  };
}
