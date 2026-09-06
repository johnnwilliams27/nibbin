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
 * THIS TABLE IS HISTORY, NOT THE CURRENT HEADLINE. Every row was measured on
 * whole responses under the older prompt. The chosen structure was re-measured
 * on the shipping configuration on 2026-09-06 and scores 0.858 [0.785, 0.910]
 * — see PRODUCTION_JUDGE_EVIDENCE below and docs/judge-headline-remeasure.md.
 * The table is kept because what it decides is RELATIVE — which structure to
 * run — and that comparison is internally consistent. Do not quote a number
 * from it as the judge's accuracy.
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
 * Cheap to check, because scoring is pure and the votes are stored, and two of
 * the three open questions have since been closed.
 *
 * LABELS (closed). The ground truth was Claude-drafted while Claude models were
 * under test. `scripts/label-sensitivity.mts` bounds it: only 12 of 120 items
 * are disputed, and flipping every one of them to the models' own preferred
 * reading still leaves the voting panel losing to the best single model by 12.5
 * points against a 5.4-point resolution. The ordering among the tied top
 * structures does move, and remains unsettled — but this choice does not rest
 * on it.
 *
 * INVENTION (closed, and it is the reason to keep a judge at all).
 * `scripts/invention-eval.mts` measures the one class the corpus could not.
 * Against six real fabrications found by probing 117 retrieval tools:
 *
 *   invention recall     6/6   (4/6 under judge.v1)
 *   false accusations    1/25  (0/25 under judge.v1)
 *   the structural heuristic that produced the candidates: 81% false positive
 *
 * The two v1 misses were rubric defects, not model limits, and both were fixed
 * by naming the case: one fabrication had been read as a plain answer because
 * the payload was substantive, the other as a refusal because the content was
 * unrelated. Substantiveness is not the test, and unrelated content is not a
 * refusal.
 *
 * The one accusation is `search_docs`, which announces "no confident match — do
 * not fabricate an answer" and then returns unrelated excerpts anyway. It is
 * counted against the judge here because that is how it was labelled when the
 * candidates were read, and the label is NOT being revised now that a model has
 * disagreed with it — relabelling after seeing output is ratification, not
 * measurement. It is worth saying plainly that the judge's reasoning on it is
 * defensible and mine may be the weaker call.
 *
 * A rate-limit lift and a clean re-run of the OpenAI leg is the one still open,
 * and `scripts/rescore.mts` re-derives every number without spending anything.
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

/**
 * The benchmark this choice rests on, so a reader can find the evidence.
 *
 * READ `headline_measured_on` BEFORE QUOTING THE ACCURACY. The 120-item run was
 * scored on whole responses, and for as long as it existed the PRODUCTION call
 * site passed the judge a 300-character slice with no truncation marker —
 * exactly the configuration measured at 45% error against 13% on whole ones.
 * The number therefore described a system we were not running. The call site is
 * fixed; the headline has not been re-earned, because doing so costs another
 * full run.
 *
 * What HAS been re-measured on the running configuration is the invention
 * class, below, which is the one this judge exists for.
 */
export const PRODUCTION_JUDGE_EVIDENCE = {
  run: "runs/judge-benchmark-2026-09-06T18-17-37-522Z.json",
  corpus_items: 120,
  /**
   * Re-measured 2026-09-06 on the configuration we actually ship: whole
   * responses, `truncated` present, current prompt. 103/120, no abstentions,
   * nothing harness-blocked.
   */
  coverage_adjusted_accuracy: 0.858,
  ci95: [0.785, 0.91] as const,
  /** Structures inside this many points are not distinguishable at n=120. */
  resolution_points: 5.4,
  /**
   * The previous headline, and why it is not simply "the old number".
   *
   * 0.892 [0.836, 0.948] was measured on whole responses while the production
   * call site passed a 300-character slice with no truncation marker — the
   * configuration separately measured at 45% error against 13% on whole ones.
   * It described a system we were not running.
   *
   * The two runs are NOT distinguishable at n=120: each headline sits inside
   * the other's interval. Reading a regression from this pair is reading noise.
   * 0.858 is quoted because it is the number measured on what ships.
   */
  superseded_headline: "0.892 [0.836, 0.948], measured on whole responses while production sent fragments",
  /**
   * Where the 17 misses actually come from — see docs/judge-headline-remeasure.md.
   *
   * Seven of them land on a boundary this rubric defines TWICE, incompatibly:
   * an empty-handed finding is an `answer` at line 286 and an explicit "no
   * match" is a `refusal` at line 291, and a search returning no_match is both.
   * That single contradiction is 41% of all measured error, and no amount of
   * re-measuring fixes it — it needs a product decision about whether a tool
   * that honestly finds nothing has worked.
   *
   * One miss is a genuine judge defect: it called 2026-dated release data
   * invention because the dates sit past its training. It treats its own cutoff
   * as the edge of reality, which fires hardest against subjects whose data is
   * most current.
   */
  known_error_structure: "7 rubric self-contradiction, 7 answer/invention boundary, 1 cutoff-as-reality-test",
  /**
   * Invention recall, re-run after the fragment fix: 6/6, 1/25 false
   * accusations — identical to the pre-fix result. Weaker evidence than it
   * looks: invention-eval reads stored transcripts and already used the full
   * `text` field, so it was never the caller passing fragments.
   */
  invention_recall_after_fix: "6/6, 1/25 false accusations (2026-09-05)",
  /**
   * THE STANDING WEAKNESS. The labels were drafted by a Claude model while
   * Claude models were under test, and no human has reviewed a sample. This
   * run does not improve that and must not be read as if it does — it does
   * narrow it to a specific 17-item worklist.
   */
  labels_unreviewed: true,
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
