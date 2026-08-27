import { describe, expect, it } from "vitest";
import { classifyLifecycle, type LifecycleConstants, type LifecycleInputs } from "../src/lifecycle.js";
import { intFx } from "../src/fixedmath.js";

const constants: LifecycleConstants = {
  liveWindowDays: intFx(90),
  dormantWindowDays: intFx(180),
};

const AS_OF = 1_800_000_000; // arbitrary fixed epoch-seconds instant, no wall clock read

function base(overrides: Partial<LifecycleInputs>): LifecycleInputs {
  return {
    metadataStatus: "resolved",
    declaredEndpoints: 1,
    agentWalletActive: true,
    lastActivitySec: null,
    asOfSec: AS_OF,
    ...overrides,
  };
}

describe("classifyLifecycle", () => {
  it("no activity, resolved metadata -> registered (metadataMissing false)", () => {
    expect(
      classifyLifecycle(base({ lastActivitySec: null, metadataStatus: "resolved" }), constants),
    ).toBe("registered");
  });

  it("no activity, unresolved metadata but declared endpoints -> registered (declaredEndpoints !== 0)", () => {
    expect(
      classifyLifecycle(
        base({ lastActivitySec: null, metadataStatus: "absent", declaredEndpoints: 2, agentWalletActive: false }),
        constants,
      ),
    ).toBe("registered");
  });

  it("no activity, unresolved metadata, no endpoints, but wallet active -> registered (agentWalletActive true)", () => {
    expect(
      classifyLifecycle(
        base({ lastActivitySec: null, metadataStatus: "unreachable", declaredEndpoints: 0, agentWalletActive: true }),
        constants,
      ),
    ).toBe("registered");
  });

  it("no activity, unresolved metadata, no endpoints, wallet inactive -> placeholder (full true path)", () => {
    expect(
      classifyLifecycle(
        base({ lastActivitySec: null, metadataStatus: "absent", declaredEndpoints: 0, agentWalletActive: false }),
        constants,
      ),
    ).toBe("placeholder");
  });

  it("malformed metadata with no endpoints or wallet activity also placeholders", () => {
    expect(
      classifyLifecycle(
        base({ lastActivitySec: null, metadataStatus: "malformed", declaredEndpoints: 0, agentWalletActive: false }),
        constants,
      ),
    ).toBe("placeholder");
  });

  it("throws when activity is reported after as_of (inconsistent snapshot)", () => {
    expect(() => classifyLifecycle(base({ lastActivitySec: AS_OF + 1 }), constants)).toThrow(RangeError);
  });

  it("activity at as_of exactly (zero gap) -> live", () => {
    expect(classifyLifecycle(base({ lastActivitySec: AS_OF }), constants)).toBe("live");
  });

  it("activity within the live window -> live", () => {
    expect(classifyLifecycle(base({ lastActivitySec: AS_OF - 10 * 86400 }), constants)).toBe("live");
  });

  it("activity exactly at the live window boundary -> live (<=)", () => {
    expect(classifyLifecycle(base({ lastActivitySec: AS_OF - 90 * 86400 }), constants)).toBe("live");
  });

  it("activity just past the live window, short of dormant -> registered (the gap interpretation)", () => {
    expect(classifyLifecycle(base({ lastActivitySec: AS_OF - 91 * 86400 }), constants)).toBe("registered");
  });

  it("activity exactly at the dormant window boundary -> dormant (>=)", () => {
    expect(classifyLifecycle(base({ lastActivitySec: AS_OF - 180 * 86400 }), constants)).toBe("dormant");
  });

  it("activity well past the dormant window -> dormant", () => {
    expect(classifyLifecycle(base({ lastActivitySec: AS_OF - 400 * 86400 }), constants)).toBe("dormant");
  });
});
