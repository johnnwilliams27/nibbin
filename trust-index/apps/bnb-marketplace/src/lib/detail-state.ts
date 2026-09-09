import type { Agent } from './types';

/** A legacy or invalid status tells us nothing about why detail is missing. */
export function normaliseDetailStatus(value: unknown): Agent['detail_status'] {
  return value === 'read' || value === 'unread_rate_limited' ? value : 'unread_unknown';
}

/** Declared interface only; this does not establish reachability or behaviour. */
export function isCallable(a: Pick<Agent, 'endpoint' | 'protocols'>): boolean {
  return Boolean(a.endpoint) || a.protocols.some((p) => p.toUpperCase() === 'MCP' || p.toUpperCase() === 'A2A');
}

export function isEndpointUnknown(a: Pick<Agent, 'endpoint' | 'protocols' | 'detail_status'>): boolean {
  return a.detail_status !== 'read' && !isCallable(a);
}

/** Only an explicitly read record can establish the absence of a declaration. */
export function isNotCallable(a: Pick<Agent, 'endpoint' | 'protocols' | 'detail_status'>): boolean {
  return a.detail_status === 'read' && !isCallable(a);
}

export function detailGapReason(status: unknown): string {
  return status === 'unread_rate_limited'
    ? 'We could not read its registry detail before hitting the rate limit, so we do not know whether it declares an endpoint.'
    : 'This snapshot has no confirmed registry detail, so we do not know whether it declares an endpoint or why the detail is missing.';
}
