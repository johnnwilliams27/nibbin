/**
 * CRM / gallery scan modules (§4.4): lead response lag, pipeline stalls,
 * delivery-step latency (shoot → gallery → delivery email).
 * Adapters: honeybook (projects), pixieset (collections).
 */
import type { ScanContext, ScanModule } from '@nibbin/connectors';
import { DAY_MS, makeFinding, median, round1 } from '../findings';
import { parseQuarantinedJson } from '../unwrap';

interface HoneyBookProject {
  id: string;
  stage?: string;
  created_at?: string;
  updated_at?: string;
}

interface PixiesetCollection {
  id: string;
  created_at?: string;
  published_at?: string;
}

const LEAD_STAGES = new Set(['inquiry', 'lead', 'new']);
const CLOSED_STAGES = new Set(['completed', 'archived', 'cancelled', 'declined']);

async function fetchProjects(ctx: ScanContext): Promise<HoneyBookProject[]> {
  const params = new URLSearchParams({
    updated_since: new Date(ctx.window.startMs).toISOString(),
    page: '1',
  });
  const res = parseQuarantinedJson<{ projects?: HoneyBookProject[] }>(
    await ctx.reader.read(`/v2/projects?${params}`),
  );
  return res?.projects ?? [];
}

function parseTs(iso: string | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export const crmLeadResponseLag: ScanModule = {
  id: 'crm.lead-response-lag',
  providers: ['honeybook'],
  async run(ctx) {
    const projects = await fetchProjects(ctx);
    const waiting = projects.filter((p) => {
      const created = parseTs(p.created_at);
      return (
        LEAD_STAGES.has((p.stage ?? '').toLowerCase()) &&
        created !== null &&
        ctx.window.endMs - created > 3 * DAY_MS
      );
    });
    if (waiting.length < 2) return [];
    const oldestDays = Math.round(
      (ctx.window.endMs - Math.min(...waiting.map((p) => parseTs(p.created_at) ?? ctx.window.endMs))) / DAY_MS,
    );
    return [
      makeFinding(
        this.id,
        ctx.connection.id,
        `${waiting.length} new inquiries have sat in your pipeline for 3+ days without a first reply — the oldest for ${oldestDays} days. Inquiries go cold fast.`,
        {
          hoursPerWeek: round1((waiting.length * 10) / 60),
          basis: `${waiting.length} projects still in an inquiry stage after 3 days; ~10 min each for a first response`,
        },
        { waiting: waiting.length, oldestDays, projectIds: waiting.slice(0, 10).map((p) => p.id) },
      ),
    ];
  },
};

export const crmPipelineStalls: ScanModule = {
  id: 'crm.pipeline-stalls',
  providers: ['honeybook'],
  async run(ctx) {
    const projects = await fetchProjects(ctx);
    const stalled = projects.filter((p) => {
      const updated = parseTs(p.updated_at);
      return (
        !CLOSED_STAGES.has((p.stage ?? '').toLowerCase()) &&
        !LEAD_STAGES.has((p.stage ?? '').toLowerCase()) &&
        updated !== null &&
        ctx.window.endMs - updated > 14 * DAY_MS
      );
    });
    if (stalled.length < 2) return [];
    return [
      makeFinding(
        this.id,
        ctx.connection.id,
        `${stalled.length} active projects haven't moved in two weeks — usually one nudge away from moving again.`,
        {
          hoursPerWeek: round1((stalled.length * 8) / 60),
          basis: `${stalled.length} open projects with no update in 14+ days; ~8 min each to follow up`,
        },
        { stalled: stalled.length, projectIds: stalled.slice(0, 10).map((p) => p.id) },
      ),
    ];
  },
};

export const crmDeliveryLatency: ScanModule = {
  id: 'crm.delivery-latency',
  providers: ['pixieset'],
  async run(ctx) {
    const res = parseQuarantinedJson<{ data?: PixiesetCollection[] }>(
      await ctx.reader.read('/v1/collections?page=1'),
    );
    const collections = (res?.data ?? []).filter((c) => {
      const created = parseTs(c.created_at);
      return created !== null && created >= ctx.window.startMs && created < ctx.window.endMs;
    });
    if (collections.length === 0) return [];

    const gaps = collections
      .map((c) => {
        const created = parseTs(c.created_at);
        const published = parseTs(c.published_at);
        return created !== null && published !== null && published >= created ? published - created : null;
      })
      .filter((g): g is number => g !== null);
    const unpublished = collections.filter((c) => !c.published_at);
    const medianDays = round1(median(gaps) / DAY_MS);

    const findings = [];
    if (gaps.length >= 3 && medianDays >= 7) {
      findings.push(
        makeFinding(
          this.id,
          ctx.connection.id,
          `Galleries take a median ${medianDays} days from shoot to delivery — clients are happiest (and pay fastest) inside a week.`,
          {
            hoursPerWeek: Math.max(0.1, round1((gaps.length * 6) / 60 / 13)),
            basis: `${gaps.length} collections published in 12 months; median created→published gap ${medianDays} days`,
          },
          { published: gaps.length, medianDays },
        ),
      );
    }
    if (unpublished.length >= 2) {
      findings.push(
        makeFinding(
          this.id,
          ctx.connection.id,
          `${unpublished.length} galleries are finished but never went out — shoots your clients are still waiting on.`,
          {
            hoursPerWeek: round1((unpublished.length * 5) / 60),
            basis: `${unpublished.length} collections in the window with no published_at`,
          },
          { unpublished: unpublished.length, collectionIds: unpublished.slice(0, 10).map((c) => c.id) },
        ),
      );
    }
    return findings;
  },
};

export const CRM_MODULES = [crmLeadResponseLag, crmPipelineStalls, crmDeliveryLatency];
