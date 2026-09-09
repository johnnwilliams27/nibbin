import type { Agent } from './types';

/**
 * Route identity for an agent. Kept free of any filesystem import so client
 * components can build links without dragging the server-only dataset loader
 * (and node:fs) into the browser bundle.
 *
 * An agent without an ERC-8004 token id is addressed by a stable slug of its
 * agent_id. The page then says plainly that it is not registered rather than
 * printing an invented token number.
 */
export function routeTokenId(a: Pick<Agent, 'agent_id' | 'token_id'>): string {
  return a.token_id ?? `unregistered-${a.agent_id.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 60)}`;
}

export function agentHref(a: Pick<Agent, 'agent_id' | 'token_id' | 'chain_id'>): string {
  return `/agent/${a.chain_id}/${routeTokenId(a)}`;
}
