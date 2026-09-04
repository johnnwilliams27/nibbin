/**
 * The production judge: one model, chosen by measurement.
 *
 * THE DECISION, AND THE EVIDENCE FOR IT
 *
 * A 120-item labelled benchmark compared seven structures: four cheap models
 * voting, two premium models adjudicating those votes in two presentations,
 * each premium model answering alone, and every smaller voter combination
 * re-derived from the stored votes. Artifact:
 * `runs/panel-2026-09-04T21-03-01-631Z.json`.
 *
 *   structure                        cov_acc   95% CI            cost
 *   Anthropic decider + evidence     0.908     [0.856, 0.960]    $2.17
 *   Anthropic decider, votes only    0.900     [0.846, 0.954]    $2.17
 *   claude-opus-5 alone              0.892     [0.836, 0.948]    $1.43
 *   claude-sonnet-5 alone            0.892     [0.836, 0.948]    $0.55
 *   gpt-5.5 alone                    0.880     [0.822, 0.938]    $0.85
 *   four-voter majority              0.775     [0.700, 0.850]    $0.86
 *
 * At n=120 a gap under 5.4 points is not distinguishable. The top five are one
 * cluster — the "winning" structure beats a single Sonnet by TWO ITEMS — so the
 * only real finding is that the voting panel is WORSE, and it is worse for a
 * specific reason: majority rule abstained on 19 of 120 items, declining
 * exactly the questions that were worth asking. Its flattering 0.921 raw
 * accuracy was bought by not answering.
 *
 * Among the tied structures, Sonnet 5 is the cheapest by a factor of four
 * against the nominal winner and by half against Opus. Nothing measured
 * justifies paying more, so:
 *
 *   ONE MODEL. NO PANEL. claude-sonnet-5.
 *
 * WHAT THIS DECISION IS NOT
 *
 * It is not a finding that Anthropic beats OpenAI. Three things forbid that
 * reading and all three are still open: the gap sits inside the noise band;
 * gpt-5.5 answered 97 items to Claude's 120 because of a rate limit on our
 * account, not a property of the model; and the ground-truth labels were
 * drafted by a Claude model while Claude models were under test. The structural
 * findings survive all three. The vendor ordering does not.
 *
 * WHAT WOULD OVERTURN IT
 *
 * Cheap to check, because scoring is pure and the votes are stored. A human
 * review pass over a stratified sample of labels; a rate-limit lift and a clean
 * re-run of the OpenAI leg; or an invention corpus, since zero of the 120 items
 * exercise the one class this judge most exists to catch. Any of those can move
 * the answer, and `scripts/rescore.mts` re-derives every number without
 * spending anything.
 *
 * The panel harness is kept, not deleted. It is how this decision gets revisited
 * when the models change, which they will.
 */
import { CAPABILITIES, type CapabilityProbe } from "../capability.js";
import type { JudgeClient, JudgeOptions } from "./index.js";
import { JUDGE_PROMPT_VERSION } from "./index.js";
import { anthropicJudge, chooseModel } from "./provider.js";

/** The model this project judges with. Changing it is a measurement, not an opinion. */
export const PRODUCTION_JUDGE_MODEL = "claude-sonnet-5";

/** The benchmark this choice rests on, so a reader can find the evidence. */
export const PRODUCTION_JUDGE_EVIDENCE = {
  run: "runs/panel-2026-09-04T21-03-01-631Z.json",
  corpus_items: 120,
  coverage_adjusted_accuracy: 0.892,
  ci95: [0.836, 0.948] as const,
  /** Structures inside this many points are not distinguishable at n=120. */
  resolution_points: 5.4,
};

export type ProductionJudgeConfig = {
  apiKey: string;
  /** Only needed for an org-scoped key; a workspace-scoped one ignores it. */
  workspaceId?: string;
  /** Override for a re-evaluation. Production should leave it alone. */
  model?: string;
};

/**
 * Build the judge.
 *
 * Deliberately returns `JudgeOptions` rather than a bare client: `modelId` and
 * the prompt version travel with every verdict, and a judged observation that
 * cannot name what produced it is not attributable. `observerId` is derived
 * from both, so a model change or a prompt change makes new verdicts distinct
 * from old ones instead of silently blending with them.
 */
export function createJudge(config: ProductionJudgeConfig): JudgeOptions {
  const model = config.model ?? PRODUCTION_JUDGE_MODEL;
  const client: JudgeClient = anthropicJudge({
    apiKey: config.apiKey,
    model,
    ...(config.workspaceId === undefined ? {} : { workspaceId: config.workspaceId }),
  });
  return { client, modelId: model, observerId: `judge:${model}:${JUDGE_PROMPT_VERSION}` };
}

/**
 * Read the key from the environment, or return null.
 *
 * Null rather than throwing, because a run without a judge is a legitimate run
 * with judged checks recorded as harness gaps. Refusing to start would make the
 * structural checks hostage to a credential they do not need.
 */
export function judgeFromEnv(env: NodeJS.ProcessEnv = process.env): JudgeOptions | null {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (typeof apiKey !== "string" || apiKey.length === 0) return null;
  const workspaceId = env.ANTHROPIC_WORKSPACE_ID;
  return createJudge({ apiKey, ...(workspaceId === undefined ? {} : { workspaceId }) });
}

/**
 * Capability probe for the judge.
 *
 * Makes ONE real minimal call. A models-listing check would pass on an account
 * with no credits and no rate limit headroom — which is exactly how a run once
 * completed 255 calls, every one of them a 429, and still printed a ranking.
 * A catalogue answers "does this model exist"; only a call answers "can we use
 * it".
 */
export function judgeCapabilityProbe(options: JudgeOptions | null): CapabilityProbe {
  return {
    id: CAPABILITIES.judge_model,
    provisioning_note: `Anthropic API key in ANTHROPIC_API_KEY with credit and rate-limit headroom for ${PRODUCTION_JUDGE_MODEL}`,
    check: async () => {
      if (options === null) {
        return { available: false, reason: "not_provisioned", detail: "ANTHROPIC_API_KEY is not set" };
      }
      try {
        await options.client({
          task: "response_classification",
          instruction: "Reply with the verdict `answer`. This is a liveness check.",
          untrusted: { probe: "ok" },
          allowed: ["answer"],
        });
        return { available: true };
      } catch (err) {
        const detail = err instanceof Error ? err.message.slice(0, 200) : "judge probe threw";
        // A rate limit or an exhausted balance is a capability we HAVE that has
        // stopped working, which is a different fix from one we never had.
        const exhausted = /429|rate limit|credit|quota|billing/i.test(detail);
        return { available: false, reason: exhausted ? "exhausted" : "unreachable", detail };
      }
    },
  };
}
