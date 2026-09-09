'use client';

import { useState } from 'react';
import { AlertTriangle, Check, Copy, ExternalLink } from 'lucide-react';
import type { Agent } from '@/lib/types';
import { chainName, isTestnet } from '@/lib/format';

/**
 * An endpoint on loopback is real, but it is not reachable by anyone reading
 * this page. Saying "copy this URL into your client" for 127.0.0.1 would be a
 * dead end dressed up as an activation, so those agents get the honest
 * CLI-assisted path instead.
 */
function isLocalEndpoint(endpoint: string | null): boolean {
  if (!endpoint) return false;
  return /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(endpoint);
}

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
  const local = isLocalEndpoint(agent.endpoint);
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

  const cliCommand = [
    `# 1. negotiate off-chain for a seller-signed quote (valid 15 min)`,
    `#    POST the "negotiate" skill to the seller and save the reply's data part as quote.json`,
    `# 2. the four on-chain writes, as one command:`,
    `bag erc8183 buy \\`,
    `  --provider ${agent.owner_address || '<SELLER_ADDRESS>'} \\`,
    `  --quote-json ./quote.json \\`,
    `  --budget-u 0 --deadline-min 20 \\`,
    `  --network ${agent.chain_id === 97 ? 'bsc-testnet' : 'bsc-mainnet'}`,
    `# 3. tell the seller it is funded, then: bag erc8183 status <JOB_ID>`,
  ].join('\n');

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
        {local ? (
          <div>
            <p className="text-[13px] font-medium" style={{ color: 'var(--withheld)' }}>
              Not reachable from your machine
            </p>
            <p className="mt-1.5 text-[13px] text-[var(--fg-muted)]">
              Its endpoint is <span className="mono break-all">{agent.endpoint}</span> — a loopback address. It runs,
              and we have exercised it, but it is not published on the public internet, so there is no URL you can point
              a client at. We are not going to give you one that fails.
            </p>
            <p className="mt-3 text-[13px] text-[var(--fg-muted)]">
              Hiring it goes through ERC-8183 on {chainName(agent.chain_id)}, which is five steps, not one: negotiate
              off-chain for a seller-signed quote (valid 15 minutes), then <span className="mono">createJob</span>,{' '}
              <span className="mono">registerJob</span>, <span className="mono">setBudget</span> and{' '}
              <span className="mono">fund</span> on the commerce contract. There is no single{' '}
              <span className="mono">hire()</span> entrypoint.
            </p>

            <p className="eyebrow mt-4">CLI-assisted hire</p>
            <p className="mt-1 text-[12px] text-[var(--fg-muted)]">
              Run this against a local checkout with the seller running. This is a command for you to execute — the
              button below copies text, it does not hire anything.
            </p>
            <pre className="mono mt-2 overflow-x-auto rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--panel-2)] p-3 text-[11px] leading-relaxed">
              {cliCommand}
            </pre>
            <button
              type="button"
              onClick={() => copy(cliCommand, 'cli')}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-btn)] border px-4 py-2.5 text-[13px] font-medium"
              style={{ borderColor: 'var(--withheld)', color: 'var(--withheld)' }}
            >
              {copied === 'cli' ? (
                <>
                  <Check size={14} strokeWidth={1.5} /> Copied
                </>
              ) : (
                <>
                  <Copy size={14} strokeWidth={1.5} /> Copy the hire command
                </>
              )}
            </button>
            {isTestnet(agent.chain_id) ? (
              <p className="mt-2 text-[12px] text-[var(--fg-faint)]">
                {chainName(agent.chain_id)}. No real funds move, and you will need testnet gas of your own — the
                sponsorship that made our own runs free is not available to a browser wallet.
              </p>
            ) : null}
          </div>
        ) : agent.endpoint === null && agent.detail_status === 'unread_rate_limited' ? (
          // We never read this agent's registry detail, so we do not know
          // whether it declares an endpoint. Saying "cannot be hired" here
          // would publish our rate-limit gap as a fact about the agent.
          <div>
            <p className="text-[13px] font-medium" style={{ color: 'var(--neutral-fg)' }}>
              We do not know whether this agent can be hired
            </p>
            <p className="mt-1.5 text-[13px] text-[var(--fg-muted)]">
              Only the registry&apos;s detail view carries an endpoint, and we hit its rate limit before reading this
              one. That is our gap, not a finding about the agent — it may well be callable. It is excluded from our
              &ldquo;declares no endpoint&rdquo; counts for exactly that reason, and the next successful fetch resolves it.
            </p>
          </div>
        ) : agent.endpoint === null ? (
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
