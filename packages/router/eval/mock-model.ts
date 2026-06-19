/**
 * Deterministic mock model for `--mock` mode — returns canned, schema-valid
 * outputs per task with a fixed token usage so the runner produces stable
 * results with NO network and NO spend. Implements the package's `Generate`
 * surface, so it slots in exactly where the real Anthropic client would.
 *
 * The canned outputs are intentionally VALID for each task's rubric so a mock
 * run exercises the full pipeline (build prompt → "call" model → judge →
 * aggregate → clearance) end-to-end. Token usage is fixed so the cost-delta
 * column is deterministic and reflects the model's pricing tier.
 */
import type { Generate, GenerateRequest, GenerateResult } from '../src/anthropic';

/** Canned, schema-valid output keyed by a signature of the system prompt. */
function cannedOutput(req: GenerateRequest): string {
  const sys = req.system.map((b) => b.text).join('\n');
  if (sys.includes('You are the Composer for Nibbin')) {
    return '{"displayName":"Morning ops","steps":[{"capability":"digest.morning","inputs":{}}],"personaPolicy":{"tone":"warm, plainspoken"}}';
  }
  if (sys.includes('You are the Planner for Nibbin')) {
    return '{"goal":"Draft follow-ups for quiet threads","intendedSteps":["Search recent inbox threads","Identify ones with no reply","Draft a gentle follow-up for each","done"],"toolsAllowlist":["email.search","email.draft","done"],"requiredConnectors":["gmail"]}';
  }
  if (sys.includes('You label clusters of observed work')) {
    return '{"label":"Chasing quiet email threads","category":"email"}';
  }
  if (sys.includes('You are a Nibbin drafting a short message')) {
    return "Hi — just circling back on the quote I sent over. No rush at all, but I wanted to check whether you had any questions or wanted me to walk through anything. Happy to help however is easiest for you.";
  }
  return 'OK';
}

/** Fixed per-model token usage so cost deltas are deterministic in mock mode. */
const FIXED_USAGE = {
  inputTokens: 1200,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 180,
};

export function createMockGenerate(): Generate {
  return async (req: GenerateRequest): Promise<GenerateResult> => ({
    text: cannedOutput(req),
    usage: { ...FIXED_USAGE },
    stopReason: 'end_turn',
    model: req.model,
  });
}
