/**
 * D2a gate (protocol): render the suppressed pages (placeholder and
 * unparseable-scale fixtures, plus every other fixture the fallback
 * estimator suppresses) and assert no digit sequence renders in the score
 * region.
 *
 * Method: render the actual /agent/[chain]/[id] Server Component with
 * react-dom/server (it is a plain async function returning JSX built only
 * from our own components), then isolate the element carrying
 * data-testid="score-region" by balanced-tag extraction (render-helpers.ts)
 * and assert that substring contains no ASCII digit. Everything outside
 * that element (the evidence summary, ownership history, signals table) is
 * free to carry numbers, per docs/design-plan.md's reading of SPEC 14.2.
 */
import { describe, expect, it } from "vitest";
import AgentPage from "@/app/agent/[chain]/[id]/page";
import { listFixtures } from "@/lib/fixtures";
import { getDataSource } from "@/lib/get-data-source";
import { extractByAttribute, renderStatic } from "./render-helpers";

const REQUIRED_BY_PROTOCOL = ["placeholder", "unparseable-scale"];

describe("D2a: suppressed agents render no digit in the score region", async () => {
  const dataSource = getDataSource();
  const fixtures = listFixtures();

  const suppressedKeys: string[] = [];
  for (const fx of fixtures) {
    const agent = await dataSource.getAgent(fx.snapshot.chain_slug, fx.snapshot.agent_id);
    if (agent && agent.score.score === null) suppressedKeys.push(fx.key);
  }

  it("the two fixtures named by the protocol are in fact suppressed under this build", () => {
    for (const key of REQUIRED_BY_PROTOCOL) {
      expect(suppressedKeys).toContain(key);
    }
  });

  it.each(fixtures.map((fx) => [fx.key, fx.snapshot.chain_slug, fx.snapshot.agent_id] as const))(
    "%s: score region has no digits when suppressed, and shows the interval when not",
    async (key, chain, id) => {
      const jsx = await AgentPage({ params: Promise.resolve({ chain, id }) });
      const html = renderStatic(jsx);
      const scoreRegion = extractByAttribute(html, "data-testid", "score-region");

      const agent = await dataSource.getAgent(chain, id);
      expect(agent).not.toBeNull();

      if (agent!.score.score === null) {
        expect(scoreRegion).not.toMatch(/\d/);
        expect(scoreRegion.toLowerCase()).toContain("no score");
      } else {
        expect(scoreRegion).toMatch(/<svg/);
      }
    },
  );
});
