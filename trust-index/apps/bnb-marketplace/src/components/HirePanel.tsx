'use client';

import { useState } from 'react';
import { AlertTriangle, Check, Copy, ExternalLink } from 'lucide-react';
import type { Agent } from '@/lib/types';

/**
 * Activation is the end of the journey, so it carries the warnings rather than
 * hiding them behind the button. An agent with a fired gate can still be hired —
 * we are an assessor, not a gatekeeper — but not without reading what tripped.
 */
export function HirePanel({ agent }: { agent: Agent }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const gates = agent.assessment?.gates_fired ?? [];
  const blocked = gates.length > 0 && !acknowledged;
  const protocol = agent.assessment?.protocol_spoken ?? (agent.protocols.some((p) => /a2a/i.test(p)) ? 'a2a' : 'mcp');

  const config =
    agent.endpoint === null
      ? null
      : protocol === 'a2a'
        ? JSON.stringify({ agent_card: agent.endpoint, chain_id: agent.chain_id, token_id: agent.token_id }, null, 2)
        : JSON.stringify(
            {
              mcpServers: {
                [slug(agent.name)]: { url: agent.endpoint, transport: 'http' },
              },
            },
            null,
            2,
          );

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied('failed');
      setTimeout(() => setCopied(null), 2500);
    }
  }

  return (
    <section className="card overflow-hidden">
      <header className="border-b border-[var(--border)] bg-[var(--panel-2)] px-5 py-3">
        <h2 className="text-[15px]">Hire this agent</h2>
        <p className="mt-0.5 text-[12px] text-[var(--fg-muted)]">
          Trust Index does not broker, host or take payment for any agent. You connect to the operator directly.
        </p>
      </header>

      <div className="p-5">
        {agent.endpoint === null ? (
          <div>
            <p className="text-[13px] font-medium" style={{ color: 'var(--neutral-fg)' }}>
              This agent cannot be hired
            </p>
            <p className="mt-1.5 text-[13px] text-[var(--fg-muted)]">
              It declares no endpoint, so there is no address to connect to. It exists in the registry and nowhere else.
              Nothing is broken — this is the normal state for most of the {'≈'}310,000 agents on BSC.
            </p>
          </div>
        ) : (
          <>
            {gates.length > 0 ? (
              <div
                className="mb-4 rounded-[var(--radius-btn)] border p-3"
                style={{ borderColor: 'var(--critical)', background: 'var(--critical-bg)' }}
              >
                <p className="flex items-start gap-2 text-[13px] font-medium" style={{ color: 'var(--critical)' }}>
                  <AlertTriangle size={15} strokeWidth={1.5} className="mt-0.5 shrink-0" aria-hidden />
                  {gates.length === 1 ? 'A safety gate fired on this agent' : `${gates.length} safety gates fired on this agent`}
                </p>
                <p className="mt-1.5 text-[12px] text-[var(--fg-muted)]">
                  Read the safety section above before connecting.
                  {agent.x402_supported
                    ? ' This agent also accepts x402 payments, so a failed gate here can cost you funds directly.'
                    : ''}
                </p>
                <label className="mt-2.5 flex cursor-pointer items-start gap-2 text-[12px]" style={{ color: 'var(--fg)' }}>
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>I have read what tripped and want the connection details anyway.</span>
                </label>
              </div>
            ) : null}

            <div className={blocked ? 'pointer-events-none select-none opacity-35' : ''} aria-hidden={blocked}>
              <p className="eyebrow">Endpoint</p>
              <div className="mt-1.5 flex items-start gap-2">
                <code className="mono min-w-0 flex-1 break-all rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-2 text-[11px]">
                  {agent.endpoint}
                </code>
                <button
                  type="button"
                  onClick={() => copy(agent.endpoint!, 'endpoint')}
                  className="shrink-0 rounded-[var(--radius-btn)] border border-[var(--border)] p-2"
                  title="Copy endpoint"
                  disabled={blocked}
                >
                  {copied === 'endpoint' ? (
                    <Check size={14} strokeWidth={1.5} style={{ color: 'var(--measured)' }} />
                  ) : (
                    <Copy size={14} strokeWidth={1.5} />
                  )}
                </button>
              </div>

              {config ? (
                <>
                  <p className="eyebrow mt-4">
                    {protocol === 'a2a' ? 'A2A client config' : 'MCP client config'}
                  </p>
                  <p className="mt-1 text-[12px] text-[var(--fg-muted)]">
                    Paste into your client&apos;s config file to connect.
                  </p>
                  <pre className="mono mt-2 overflow-x-auto rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--panel-2)] p-3 text-[11px] leading-relaxed">
                    {config}
                  </pre>
                  <button
                    type="button"
                    onClick={() => copy(config, 'config')}
                    disabled={blocked}
                    className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-btn)] border px-4 py-2.5 text-[13px] font-medium"
                    style={{ borderColor: 'var(--measured)', color: 'var(--measured)' }}
                  >
                    {copied === 'config' ? (
                      <>
                        <Check size={14} strokeWidth={1.5} /> Copied
                      </>
                    ) : (
                      <>
                        <Copy size={14} strokeWidth={1.5} /> Copy config and activate
                      </>
                    )}
                  </button>
                  {copied === 'failed' ? (
                    <p className="mt-2 text-[12px]" style={{ color: 'var(--withheld)' }}>
                      Your browser blocked the clipboard. Nothing was sent anywhere — select the text above and copy it
                      manually.
                    </p>
                  ) : null}
                </>
              ) : null}

              <a
                href={agent.endpoint}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-[var(--fg-muted)] underline underline-offset-2"
              >
                Open the endpoint directly <ExternalLink size={12} strokeWidth={1.5} aria-hidden />
              </a>
            </div>
          </>
        )}

        <dl className="mt-5 space-y-1.5 border-t border-[var(--border)] pt-4 text-[12px]">
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--fg-muted)]">Payment</dt>
            <dd className="mono">{agent.x402_supported ? 'x402 supported' : 'Not declared'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--fg-muted)]">Protocol</dt>
            <dd className="mono">
              {agent.assessment?.protocol_spoken?.toUpperCase() ?? (agent.protocols.join(', ') || 'None')}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--fg-muted)]">Operator</dt>
            <dd className="mono break-all">{agent.owner_address || 'Unknown'}</dd>
          </div>
        </dl>

        <p className="mt-4 text-[12px] text-[var(--fg-faint)]">
          Give it the narrowest permission that lets it do the job, and a spend limit you could lose without it
          mattering. Our assessment tells you what answered when we called — it is not a guarantee of future behaviour.
        </p>
      </div>
    </section>
  );
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'agent'
  );
}
