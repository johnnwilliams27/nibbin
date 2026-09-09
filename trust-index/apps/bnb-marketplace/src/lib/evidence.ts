import type { Agent, EvidenceState } from './types';
import { compositeOutOf100 } from './format.ts';

/** Only a published, bounded independent rating can replace the evidence label. */
export function cardRating(agent: Pick<Agent, 'assessment' | 'is_reference_agent'>) {
  const assessment = agent.assessment;
  const value = assessment?.composite;
  if (agent.is_reference_agent || !assessment || assessment.gates_fired.length > 0
    || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100
    || !['thin', 'moderate', 'strong'].includes(assessment.coverage)) return null;
  return { score: compositeOutOf100(value), coverage: assessment.coverage };
}

const COPY: Record<EvidenceState, { label: string; detail: string; tone: string }> = {
  protocol_confirmed: { label: 'Protocol confirmed', detail: 'The endpoint completed a protocol exchange. Its financial performance and safety are not established by that exchange.', tone: 'var(--measured)' },
  card_retrieved: { label: 'Agent card found', detail: 'We retrieved a capability declaration. Finding a card does not establish that its skills work.', tone: 'var(--coverage)' },
  descriptor_read: { label: 'Service descriptor found', detail: 'The service describes its tools. These are self-reported capabilities, not executed checks.', tone: 'var(--coverage)' },
  auth_walled: { label: 'Authentication required', detail: 'The endpoint answered but requires access. We did not establish its protocol or test its capabilities.', tone: 'var(--withheld)' },
  rate_limited: { label: 'Check rate-limited', detail: 'The endpoint limited our request. This is a limit on our reading, not an agent failure.', tone: 'var(--withheld)' },
  response_received: { label: 'Response recorded', detail: 'We have a response, but no confirmed protocol exchange in this evidence record.', tone: 'var(--fg-muted)' },
  unmeasured: { label: 'Not yet confirmed', detail: 'We do not have a usable reading establishing how this interface behaves.', tone: 'var(--fg-muted)' },
  unsupported_transport: { label: 'Connection not supported', detail: 'Our current remote checks cannot exercise this connection method.', tone: 'var(--withheld)' },
};

export function evidenceSummary(agent: Pick<Agent, 'assessment'>) {
  const assessment = agent.assessment;
  const explicit = assessment?.evidence_state;
  const state: EvidenceState = explicit && Object.hasOwn(COPY, explicit)
    ? explicit
    : assessment?.reachable === true ? 'response_received' : 'unmeasured';
  return { state, ...COPY[state], confirmed: state === 'protocol_confirmed' };
}

/** The unit changes explicitly at each step; one shared URL is never N tests. */
export function populationSummary(agents: Agent[]) {
  const rows = agents.filter((agent) => !agent.is_reference_agent);
  const listed = rows.filter((agent) => agent.category !== 'other');
  const endpoints = (pool: Agent[]) => new Set(pool.map((agent) => agent.endpoint).filter(Boolean)).size;
  return {
    registrations: rows.length,
    listed: listed.length,
    outsideCategories: rows.length - listed.length,
    endpoints: endpoints(rows),
    listedEndpoints: endpoints(listed),
    checkedEndpoints: endpoints(rows.filter((agent) => agent.assessment !== null)),
    confirmedEndpoints: endpoints(rows.filter((agent) => evidenceSummary(agent).confirmed)),
  };
}
