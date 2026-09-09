'use client';

import { useState } from 'react';
import { AlertTriangle, Check, Copy, ExternalLink } from 'lucide-react';
import type { Agent } from '@/lib/types';
import { detailGapReason } from '@/lib/detail-state';
import { connectionPlan } from '@/lib/activation';
import { HireFlow } from './HireFlow';

const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-btn)] border border-[var(--border)] px-4 py-2 text-[13px] disabled:cursor-not-allowed disabled:opacity-40';

/** Connection instructions are not a hire. No external call happens on render. */
export function HirePanel({ agent }: { agent: Agent }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const gates = agent.assessment?.gates_fired ?? [];
  const blocked = gates.length > 0 && !acknowledged;
  const plan = connectionPlan(agent);

  async function copy(text: string, key: string) {
    if (blocked) return;
    try { await navigator.clipboard.writeText(text); setCopied(key); }
    catch { setCopied('failed'); }
  }

  return (
    <section className="card min-w-0 overflow-hidden" id="connect">
      <header className="border-b border-[var(--border)] bg-[var(--panel-2)] px-5 py-3">
        <h2 className="text-[15px]">Connect to this agent</h2>
        <p className="mt-1 max-w-4xl text-[12px] text-[var(--fg-muted)]">Review the declared interface, then connect through your own client. Nibbin does not host the operator or collect payments.</p>
      </header>
      <div className="p-5">
        {gates.length > 0 ? <div className="mb-4 rounded-[var(--radius-btn)] border p-3" style={{ borderColor: 'var(--critical)', background: 'var(--critical-bg)' }}>
          <p className="flex items-start gap-2 text-[13px] font-medium" style={{ color: 'var(--critical)' }}><AlertTriangle size={16} strokeWidth={1.5} className="shrink-0" aria-hidden /> Safety findings need your attention</p>
          <ul className="mono mt-2 space-y-1 break-all text-[11px]">{gates.map((gate) => <li key={gate}>{gate}</li>)}</ul>
          <p className="mt-2 text-[12px]">Read the evidence and safety section before connecting. Acknowledging a finding does not clear it.</p>
          <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2 text-[12px]"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>I have read the findings and want the connection details.</span></label>
        </div> : null}

        {agent.endpoint === null && agent.detail_status !== 'read' ? (
          <div><p className="text-[13px] font-medium">We do not know whether this agent can be hired</p><p className="mt-2 text-[13px] text-[var(--fg-muted)]">{detailGapReason(agent.detail_status)} This is a gap in our data, not an absent endpoint established by a reading.</p></div>
        ) : agent.endpoint === null ? (
          <div><p className="text-[13px] font-medium">No endpoint declared in the registry detail we read</p><p className="mt-2 text-[13px] text-[var(--fg-muted)]">This snapshot gives us no endpoint to connect to. We have not established whether the agent can be reached or hired elsewhere.</p></div>
        ) : !plan.url ? (
          <div><p className="text-[13px] font-medium">No safe public connection link</p><p className="mt-2 text-[13px] text-[var(--fg-muted)]">The declared address is local, private, malformed, or not a supported web URL. It is not offered as a connection link. Ask the operator for a public HTTPS interface.</p><code className="mono mt-2 block break-all text-[11px]">{agent.endpoint}</code>{agent.is_reference_agent ? <p className="mt-3 text-[12px] text-[var(--fg-muted)]">This is Nibbin’s local reference implementation, not a public seller. Its historical testnet jobs are demonstrations, not jobs you can start from this page.</p> : null}</div>
        ) : <>
          <div className="grid min-w-0 items-center gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0"><p className="text-[13px] font-medium">Operator-declared endpoint</p>
              <code className="mt-2 block break-all rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-[12px]">{plan.url}</code>
            </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass} disabled={blocked} onClick={() => copy(plan.url!, 'endpoint')}><Copy size={14} strokeWidth={1.5} aria-hidden />{copied === 'endpoint' ? 'Endpoint copied' : 'Copy endpoint'}</button>
            {blocked ? <span className={`${buttonClass} opacity-40`}>Review findings to open</span> : <a href={plan.url} target="_blank" rel="noreferrer noopener" className={buttonClass}>Open {plan.descriptor ? 'descriptor' : 'declared endpoint'}<ExternalLink size={14} strokeWidth={1.5} aria-hidden /></a>}
          </div>
          </div>
          <p className="mt-3 text-[12px] text-[var(--fg-muted)]">{plan.descriptor ? 'This is a service descriptor, not a remote MCP session. Read the operator’s installation instructions; Nibbin has not run or verified the package.' : plan.protocol === 'a2a' ? 'Use this declaration with an A2A-compatible client. A card or endpoint being listed does not prove that its skills run.' : plan.protocol === 'mcp' ? 'This template is for clients that accept remote MCP URLs. Client formats and authentication requirements vary; a declaration is not a connection test.' : 'We have not established a client protocol for this address. We will not invent an MCP configuration for it.'}</p>
          <p className="mt-3 text-[12px] text-[var(--fg-muted)]">Opening or copying connection details does not activate or hire anything. Visiting the operator’s site shares your request with that operator.</p>
        </>}
        <p role="status" aria-live="polite" className="mt-2 text-[12px]" style={{ color: 'var(--withheld)' }}>{copied === 'failed' ? 'The clipboard was unavailable. Select and copy the text manually. Nothing was sent to the operator.' : copied ? 'Copied locally. No agent was activated and no payment was requested.' : ''}</p>
        <details className="mt-3 border-t border-[var(--border)] pt-2">
          <summary className="min-h-11 cursor-pointer py-2 text-[14px] font-medium">Connection setup and operator details</summary>
          <div className="grid min-w-0 gap-5 pt-2 lg:grid-cols-2">
          {plan.config ? <div className="min-w-0">
            <p className="text-[13px] font-medium">MCP connection template</p>
            <pre className="mono mt-2 overflow-x-auto rounded-[var(--radius-btn)] border border-[var(--border)] bg-[var(--panel-2)] p-3 text-[11px]">{plan.config}</pre>
            <button type="button" className={`${buttonClass} mt-2`} disabled={blocked} onClick={() => copy(plan.config!, 'config')}>{copied === 'config' ? <Check size={14} strokeWidth={1.5} aria-hidden /> : <Copy size={14} strokeWidth={1.5} aria-hidden />}{copied === 'config' ? 'Configuration copied' : 'Copy configuration'}</button>
            <ol className="mt-3 list-decimal space-y-1 pl-4 text-[12px] text-[var(--fg-muted)]"><li>Add the URL in your client’s remote MCP settings, or adapt this template to its documented format.</li><li>Review requested permissions and authenticate directly with the operator if needed.</li><li>Inspect available tools before enabling any call. Set spending limits separately.</li></ol>
          </div> : null}
          <dl className="min-w-0 space-y-3 text-[12px]">
            <div><dt className="text-[var(--fg-muted)]">Payment declaration</dt><dd className="mt-1">{agent.x402_supported ? 'x402 · Self-reported' : 'Not declared'}</dd></div>
            <div><dt className="text-[var(--fg-muted)]">Declared protocols</dt><dd className="mt-1 break-words">{agent.protocols.join(', ') || 'Unknown'}</dd></div>
            <div><dt className="text-[var(--fg-muted)]">Registry owner · not a verified payment recipient</dt><dd className="mt-1 break-all">{agent.owner_address || 'Unknown'}</dd></div>
          </dl>
          </div>
        </details>
        {agent.chain_id === 56 || agent.chain_id === 97 ? <details className="mt-1">
          <summary className="min-h-11 cursor-pointer py-2 text-[14px] font-medium">Hire through an ERC-8183-compatible seller</summary>
          <HireFlow key={agent.agent_id} chainId={agent.chain_id} providerAddress={agent.owner_address} sellerEndpoint={plan.protocol === 'a2a' ? plan.url ?? '' : ''} defaultTask="" disabled={blocked} />
        </details> : null}
      </div>
    </section>
  );
}
