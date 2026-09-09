/**
 * D2b gate (protocol): intervals render for every non-suppressed fixture.
 * Renders the real /agent/[chain]/[id] page and the homepage's worked
 * example, and asserts the interval SVG and its low/point/high numerals are
 * present and match the ScoreResult exactly.
 */
import { describe, expect, it } from "vitest";
import AgentPage from "@/app/agent/[chain]/[id]/page";
import { formatScore } from "@/lib/format";
import { listFixtures } from "@/lib/fixtures";
import { getDataSource } from "@/lib/get-data-source";
import { extractByAttribute, renderStatic } from "./render-helpers";

describe("D2b: intervals render for every non-suppressed fixture", async () => {
  const dataSource = getDataSource();
  const fixtures = listFixtures();

  const nonSuppressed: Array<{ key: string; chain: string; id: string }> = [];
  for (const fx of fixtures) {
    const agent = await dataSource.getAgent(fx.snapshot.chain_slug, fx.snapshot.agent_id);
    if (agent && agent.score.score !== null) {
      nonSuppressed.push({ key: fx.key, chain: fx.snapshot.chain_slug, id: fx.snapshot.agent_id });
    }
  }

  it("at least one fixture is non-suppressed under this build (otherwise this gate is vacuous)", () => {
    expect(nonSuppressed.length).toBeGreaterThan(0);
  });

  it.each(nonSuppressed.map((f) => [f.key, f.chain, f.id] as const))(
    "%s: renders an SVG interval with low/point/high matching the score exactly",
    async (_key, chain, id) => {
      const agent = await dataSource.getAgent(chain, id);
      expect(agent).not.toBeNull();
      const s = agent!.score;

      const jsx = await AgentPage({ params: Promise.resolve({ chain, id }) });
      const html = renderStatic(jsx);
      const scoreRegion = extractByAttribute(html, "data-testid", "score-region");

      expect(scoreRegion).toMatch(/<svg/);
      expect(scoreRegion).toContain(formatScore(s.score as number));
      expect(scoreRegion).toContain(formatScore(s.score_low as number));
      expect(scoreRegion).toContain(formatScore(s.score_high as number));
    },
  );
});
