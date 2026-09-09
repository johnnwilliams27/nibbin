/** Client-side link guard, not a DNS or server-side SSRF guarantee. */
export function publicEndpoint(value: string | null): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return null;
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    if (!host.includes('.') || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host)) return null;
    if (host.startsWith('[')) return null; // No literal IPv6 destinations from untrusted declarations.
    const octets = host.split('.').map(Number);
    if (octets.length === 4 && octets.every(Number.isInteger)) {
      const [a, b] = octets;
      if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return null;
    }
    return u.href;
  } catch { return null; }
}

type ConnectionAgent = {
  name: string;
  endpoint: string | null;
  protocols: string[];
  assessment: {
    protocol_spoken?: 'mcp' | 'a2a' | null;
    withheld_reason?: string | null;
    evidence_state?: string;
    capability_source?: string | null;
  } | null;
};

export function connectionPlan(agent: ConnectionAgent) {
  const url = publicEndpoint(agent.endpoint);
  const protocols = agent.protocols.map((p) => p.toLowerCase());
  const protocol = agent.assessment?.protocol_spoken ??
    (protocols.includes('a2a') && !protocols.includes('mcp') ? 'a2a' : protocols.includes('mcp') && !protocols.includes('a2a') ? 'mcp' : null);
  const descriptor = agent.assessment?.evidence_state === 'descriptor_read' ||
    agent.assessment?.capability_source === 'service_descriptor' ||
    /\bstdio\b|service descriptor/i.test(agent.assessment?.withheld_reason ?? '');
  const name = agent.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'agent';
  return {
    url, protocol, descriptor,
    config: url && protocol === 'mcp' && !descriptor
      ? JSON.stringify({ mcpServers: { [name]: { url } } }, null, 2)
      : null,
  };
}
