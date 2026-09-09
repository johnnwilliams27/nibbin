import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { Agent } from '@/lib/types';
import { agentHref } from '@/lib/routes';
import { compositeOutOf100, num } from '@/lib/format';
import { listingGroupIndex } from '@/lib/data';
import type { ListingGroup } from '@/lib/grouping';

/**
 * The registrations behind one listing, on the page that has room for them.
 *
 * The browse view shows one row per group and says nothing about why: a card is
 * for choosing between agents, and a paragraph about deployment topology on
 * every card is noise at exactly the moment someone is scanning. The
 * explanation belongs here, once, where a reader has already chosen to look
 * closely.
 *
 * A FAN-OUT AND A FLEET GET DIFFERENT TABLES because they are different facts.
 * Many registrations sharing one endpoint were measured once between them, so
 * showing a score column would repeat one reading down the page as though it
 * were N results. Deployments each have their own endpoint and their own
 * reading, so the score column is the point — including the rows where there
 * is no score, which are a gap and not a zero.
 */
const MAX_LISTED = 50;

export function RelatedRegistrations({ agent, pool }: { agent: Agent; pool: Agent[] }) {
  const group: ListingGroup | undefined = listingGroupIndex().get(agent.agent_id);
  if (group === undefined || group.registrations <= 1) return null;

  const byId = new Map(pool.map((a) => [a.agent_id, a]));
  const members = group.memberIds.map((id) => byId.get(id)).filter((a): a is Agent => a !== undefined);
  const all = members.filter((m) => m.agent_id !== agent.agent_id);
  if (all.length === 0) return null;
  /*
    Capped, because the largest group is 4,874 registrations and this renders on
    each of their pages: uncapped it is a 4,873-row table written 4,874 times,
    which took the static export from seconds to a failed build. A reader who
    needs the full membership needs a data export, not a page that never ends.
  */
  const others = all.slice(0, MAX_LISTED);
  const hidden = all.length - others.length;

  const fanout = group.kind === 'fanout';
  const gap = group.registrations - group.rated;

  return (
    <section aria-labelledby="related-registrations-heading" className="mt-8">
      <h2 id="related-registrations-heading" className="text-[20px] tracking-tight">
        {fanout ? 'Other registrations of this service' : 'Other deployments of this template'}
      </h2>
      <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-[var(--fg-muted)]">
        {fanout ? (
          <>
            {num(group.registrations)} registrations declare this same endpoint. We measured the
            service once and show that reading on each of them; this is not {num(group.registrations)}{' '}
            independent tests, and the listing above stands for all of them.
          </>
        ) : (
          <>
            {num(group.registrations)} registrations share this name, description and infrastructure,
            each declaring its own endpoint and each measured separately.{' '}
            {group.rated === 0
              ? 'None produced a published score.'
              : group.scores.length === 1
                ? `${num(group.rated)} produced a score, all of them ${group.scores[0]}.`
                : `${num(group.rated)} produced a score, from ${group.scores[0]} to ${group.scores[group.scores.length - 1]}.`}
            {gap > 0 ? ` ${num(gap)} could not be assessed — that is a gap in our evidence, not a result.` : ''}{' '}
            Different URLs can still belong to one operator, and separate readings that agree are
            not independent observers.
          </>
        )}
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left text-[14px]">
          <thead>
            <tr className="border-b border-[var(--border)] text-[13px] text-[var(--fg-muted)]">
              <th scope="col" className="py-2 pr-4 font-medium">Registration</th>
              {fanout ? null : <th scope="col" className="py-2 pr-4 font-medium">Endpoint</th>}
              <th scope="col" className="py-2 pr-4 font-medium">{fanout ? 'Registered' : 'Trust Index'}</th>
              <th scope="col" className="py-2 font-medium"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {others.map((m) => {
              const score = m.assessment?.composite ?? null;
              return (
                <tr key={m.agent_id} className="border-b border-[var(--border)] last:border-0">
                  <td className="py-3 pr-4 align-top">
                    <span className="break-words">{m.name || 'Unnamed registration'}</span>
                    <span className="mt-0.5 block font-mono text-[12px] text-[var(--fg-muted)]">#{m.token_id}</span>
                  </td>
                  {fanout ? null : (
                    <td className="py-3 pr-4 align-top">
                      <span className="break-all font-mono text-[12px] text-[var(--fg-muted)]">
                        {m.endpoint ?? 'None declared'}
                      </span>
                    </td>
                  )}
                  <td className="py-3 pr-4 align-top tabular-nums">
                    {fanout ? (
                      <span className="text-[var(--fg-muted)]">
                        {m.registered_at_block ? `block ${num(m.registered_at_block)}` : '—'}
                      </span>
                    ) : score === null ? (
                      <span className="text-[var(--fg-muted)]">Not assessed</span>
                    ) : (
                      <span>
                        <span className="font-semibold">{compositeOutOf100(score)}</span>
                        <span className="text-[var(--fg-muted)]"> / 100</span>
                      </span>
                    )}
                  </td>
                  <td className="py-3 align-top">
                    <Link
                      href={agentHref(m)}
                      className="inline-flex min-h-11 items-center gap-1.5"
                      aria-label={`View registration ${m.token_id}`}
                    >
                      View <ArrowUpRight size={14} strokeWidth={1.5} aria-hidden />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hidden > 0 ? (
        <p className="mt-3 text-[13px] text-[var(--fg-muted)]">
          Showing {num(others.length)} of {num(all.length)}. {num(hidden)} further registrations
          declare this same service and are not listed here.
        </p>
      ) : null}
    </section>
  );
}
