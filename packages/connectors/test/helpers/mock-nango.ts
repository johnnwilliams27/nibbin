/**
 * Minimal Nango SDK shape for unit tests.
 * Only the methods NangoConnectorClient uses are implemented.
 *
 * Shape note: nango.proxy() returns an Axios-style response —
 * { data: T (already-parsed JSON), status: number, statusText: string, headers, config }
 * There is NO .text() method — the Nango SDK returns parsed JSON in `data`.
 */
import { vi } from 'vitest';
import type { Nango } from '../../src/nango-client';

export interface MockNangoOpts {
  /** HTTP status code the proxy should return. Default: 200. */
  proxyStatus?: number;
  /** Parsed JSON response body (already-parsed, not a string). Default: {}. */
  proxyData?: unknown;
  /** Response headers. Default: {}. */
  proxyHeaders?: Record<string, string>;
  /** Scopes string returned by getConnection (space-separated). Default: ''. */
  getConnectionScopes?: string;
  /** When true, deleteConnection rejects with an error. Default: false. */
  deleteConnectionShouldThrow?: boolean;
}

/**
 * Returns a mock Nango instance whose proxy() resolves to an Axios-style response.
 * All methods are vi.fn() spies so tests can assert call counts / arguments.
 */
export function makeMockNango(opts: MockNangoOpts = {}): Nango {
  const proxyResponse = {
    status: opts.proxyStatus ?? 200,
    statusText: opts.proxyStatus === 200 ? 'OK' : String(opts.proxyStatus ?? 200),
    data: opts.proxyData ?? {},
    headers: opts.proxyHeaders ?? {},
    config: {},
  };

  return {
    proxy: vi.fn().mockResolvedValue(proxyResponse),
    getConnection: vi.fn().mockResolvedValue({
      credentials: { raw: { scope: opts.getConnectionScopes ?? '' } },
    }),
    deleteConnection: opts.deleteConnectionShouldThrow
      ? vi.fn().mockRejectedValue(new Error('delete failed'))
      : vi.fn().mockResolvedValue(undefined),
  } as unknown as Nango;
}
