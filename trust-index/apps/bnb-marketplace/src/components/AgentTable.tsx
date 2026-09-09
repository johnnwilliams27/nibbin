import { AgentProfileLink } from './AgentProfileLink';
import type { Agent } from '@/lib/types';
import { CATEGORY_BY_SLUG } from '@/lib/categories';
import { agentHref } from '@/lib/routes';
import { CategoryIcon, TrustIndexStatus } from './AgentCard';

export function AgentTable({ agents }: { agents: Agent[] }) {
  return (
    <div className="relative min-w-0 max-w-full overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--panel)]" role="region" aria-label="Agent comparison" tabIndex={0}>
      <table className="w-full min-w-[640px] border-collapse text-left text-[14px]">
        <caption className="sr-only">Agents and their Trust Index interface evidence. Unknown evidence is not a zero score.</caption>
        <thead className="border-b border-[var(--border)] bg-[var(--panel-2)] text-[var(--fg-muted)]">
          <tr>{['Agent', 'Category', 'Trust Index', ''].map((label, i) => <th key={i} scope="col" className="px-5 py-4 font-medium">{label || <span className="sr-only">Profile</span>}</th>)}</tr>
        </thead>
        <tbody>
          {agents.map((agent) => <tr key={agent.agent_id} className="border-b border-[var(--border)] last:border-b-0 hover:bg-[var(--panel-2)]">
            <td className="max-w-[340px] px-5 py-4">
              <AgentProfileLink href={agentHref(agent)} className="font-semibold hover:underline underline-offset-4">{agent.name}</AgentProfileLink>
              <p className="mt-1 line-clamp-2 text-[var(--fg-muted)]">{agent.description || 'No description provided.'}</p>
            </td>
            <td className="px-5 py-4 text-[var(--fg-muted)]"><span className="flex items-center gap-2"><CategoryIcon category={agent.category} />{CATEGORY_BY_SLUG.get(agent.category)?.name ?? 'Other'}</span></td>
            <td className="px-5 py-4"><TrustIndexStatus agent={agent} showLabel={false} /></td>
            <td className="px-5 py-4"><AgentProfileLink href={agentHref(agent)} aria-label={`View agent: ${agent.name}`} className="inline-flex min-h-11 items-center whitespace-nowrap underline underline-offset-4">View agent</AgentProfileLink></td>
          </tr>)}
        </tbody>
      </table>
    </div>
  );
}
