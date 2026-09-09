import type { Coverage } from './types';

const CHAIN_NAMES: Record<number, string> = {
  56: 'BNB Smart Chain',
  97: 'BSC testnet',
};

/** Never label a testnet as mainnet. An unknown chain is named by its id, not guessed. */
export function chainName(chainId: number): string {
  return CHAIN_NAMES[chainId] ?? `chain ${chainId}`;
}

export function isTestnet(chainId: number): boolean {
  return chainId === 97;
}

export function num(value: number): string {
  return value.toLocaleString('en-US');
}

export function pct(part: number, whole: number): string {
  if (whole === 0) return '—';
  const value = (part / whole) * 100;
  if (value > 0 && value < 0.1) return '<0.1%';
  return `${value.toFixed(value < 10 ? 1 : 0)}%`;
}

/** Composites are 0..1 in the contract; some producers emit 0..100. Show both safely. */
export function compositeOutOf100(composite: number): number {
  return composite <= 1 ? Math.round(composite * 100) : Math.round(composite);
}

export function latency(ms: number | null): string {
  if (ms === null) return 'Not measured';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function shortAddress(address: string | null | undefined): string {
  if (!address) return 'Unknown';
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function timestamp(iso: string | null | undefined): string {
  if (!iso) return 'Unknown';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export function relativeAge(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const hours = (Date.now() - date.getTime()) / 36e5;
  if (hours < 0) return null;
  if (hours < 1) return 'less than an hour ago';
  if (hours < 24) return `${Math.round(hours)} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'a day ago' : `${days} days ago`;
}

export const COVERAGE_COPY: Record<Coverage, { label: string; meaning: string; steps: number }> = {
  thin: {
    label: 'Thin',
    meaning: 'We got one look. Enough to confirm it answers, not enough to judge behaviour.',
    steps: 1,
  },
  moderate: {
    label: 'Moderate',
    meaning: 'We ran the standard probe set. Gaps remain in the long tail of its tools.',
    steps: 2,
  },
  strong: {
    label: 'Strong',
    meaning: 'We exercised the full probe set including adversarial prompts. Few blind spots.',
    steps: 3,
  },
};

/** Human-readable gate names. Unknown gates fall back to the raw key, never hidden. */
const GATE_COPY: Record<string, { title: string; why: string }> = {
  injection_resistance: {
    title: 'Failed injection resistance',
    why: 'It followed instructions hidden in the data it was given. Anything it can spend, an attacker can spend.',
  },
  prompt_injection: {
    title: 'Failed injection resistance',
    why: 'It followed instructions hidden in the data it was given. Anything it can spend, an attacker can spend.',
  },
  spend_cap_absent: {
    title: 'No spend cap declared',
    why: 'Nothing in its interface bounds how much it can move in one call.',
  },
  spend_cap: {
    title: 'Spend cap concern',
    why: 'Its declared spend limits did not hold under probing.',
  },
  unreachable: {
    title: 'Endpoint did not answer',
    why: 'We could not reach it during the assessment window. It may be offline.',
  },
  unauthenticated_write: {
    title: 'Unauthenticated write path',
    why: 'A state-changing tool answered without proving who was calling.',
  },
  key_exfiltration: {
    title: 'Key exfiltration risk',
    why: 'It disclosed or requested secret material it should never handle.',
  },
  self_reported_only: {
    title: 'Self-reported claims only',
    why: 'Its capability list could not be corroborated by anything we could execute.',
  },
};

export function gateCopy(gate: string): { title: string; why: string } {
  return (
    GATE_COPY[gate] ?? {
      title: gate.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
      why: 'A hard safety check tripped during assessment.',
    }
  );
}
