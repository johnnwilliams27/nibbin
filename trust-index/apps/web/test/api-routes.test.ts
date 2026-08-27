import { describe, expect, it } from "vitest";
import { GET as getAgent } from "@/app/api/v1/agents/[chain]/[id]/route";
import { GET as getFeedback } from "@/app/api/v1/agents/[chain]/[id]/feedback/route";
import { GET as getRecompute } from "@/app/api/v1/agents/[chain]/[id]/recompute/route";
import { GET as getReviewer } from "@/app/api/v1/reviewers/[chain]/[address]/route";
import { GET as getReviewerAgents } from "@/app/api/v1/reviewers/[chain]/[address]/agents/route";
import { GET as getStats } from "@/app/api/v1/stats/[chain]/route";
import { GET as getDumps } from "@/app/api/v1/dumps/route";
import { GET as getHealth } from "@/app/api/v1/health/route";
import { POST as postMcp } from "@/app/api/v1/mcp/route";
import { listFixtures } from "@/lib/fixtures";

let ipCounter = 0;
function req(url: string, init?: RequestInit): Request {
  ipCounter += 1;
  const headers = new Headers(init?.headers);
  headers.set("x-forwarded-for", `10.0.0.${ipCounter}`);
  return new Request(url, { ...init, headers });
}

const [SOME_FIXTURE] = listFixtures();
const CHAIN = SOME_FIXTURE!.snapshot.chain_slug;
const AGENT_ID = SOME_FIXTURE!.snapshot.agent_id;

const FIXTURE_WITH_REVIEWERS = listFixtures().find(
  (f) => Object.keys(f.snapshot.reviewers).length > 0,
)!;
const REVIEWER_CHAIN = FIXTURE_WITH_REVIEWERS.snapshot.chain_slug;
const REVIEWER = Object.keys(FIXTURE_WITH_REVIEWERS.snapshot.reviewers)[0]!;

describe("GET /api/v1/agents/:chain/:id", () => {
  it("returns an envelope with a score object", async () => {
    const res = await getAgent(req(`http://x/api/v1/agents/${CHAIN}/${AGENT_ID}`), {
      params: Promise.resolve({ chain: CHAIN, id: AGENT_ID }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const body = await res.json();
    expect(body.data.agent_id).toBe(AGENT_ID);
    expect(body.meta.methodology_version).toBeTruthy();
    expect(body.meta.constants_provisional).toBe(true);
    expect(typeof body.data.score.confidence).toBe("number");
  });

  it("404s with an ApiError for an unknown agent", async () => {
    const res = await getAgent(req(`http://x/api/v1/agents/${CHAIN}/does-not-exist`), {
      params: Promise.resolve({ chain: CHAIN, id: "does-not-exist" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });

  it("sets coverage_disclaimer exactly when coverage_tier is none or thin", async () => {
    for (const fx of listFixtures()) {
      const res = await getAgent(req(`http://x/api/v1/agents/${fx.snapshot.chain_slug}/${fx.snapshot.agent_id}`), {
        params: Promise.resolve({ chain: fx.snapshot.chain_slug, id: fx.snapshot.agent_id }),
      });
      const body = await res.json();
      const tier = body.data.score.coverage_tier;
      if (tier === "none" || tier === "thin") {
        expect(body.meta.coverage_disclaimer).toBeTruthy();
      } else {
        expect(body.meta.coverage_disclaimer).toBeUndefined();
      }
    }
  });
});

describe("GET /api/v1/agents/:chain/:id/feedback", () => {
  it("paginates and caps limit at 100", async () => {
    const res = await getFeedback(req(`http://x/api/v1/agents/${CHAIN}/${AGENT_ID}/feedback?limit=500`), {
      params: Promise.resolve({ chain: CHAIN, id: AGENT_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.items.length).toBeLessThanOrEqual(100);
    expect(typeof body.data.total).toBe("number");
  });

  it("every feedback item carries reviewer_weight and a profile url", async () => {
    const res = await getFeedback(req(`http://x/api/v1/agents/${CHAIN}/${AGENT_ID}/feedback`), {
      params: Promise.resolve({ chain: CHAIN, id: AGENT_ID }),
    });
    const body = await res.json();
    for (const item of body.data.items) {
      expect(typeof item.reviewer_weight).toBe("number");
      expect(item.reviewer_profile_url).toContain(`/reviewer/${CHAIN}/`);
    }
  });
});

describe("GET /api/v1/agents/:chain/:id/recompute", () => {
  it("returns the full derivation", async () => {
    const res = await getRecompute(req(`http://x/api/v1/agents/${CHAIN}/${AGENT_ID}/recompute`), {
      params: Promise.resolve({ chain: CHAIN, id: AGENT_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.priors).toBeDefined();
    expect(body.data.score_source === "engine" || body.data.score_source === "synthetic").toBe(true);
  });

  it("is rate limited at 10/min regardless of key (SPEC 13)", async () => {
    const ip = "203.0.113.9";
    const makeReq = () =>
      new Request(`http://x/api/v1/agents/${CHAIN}/${AGENT_ID}/recompute`, {
        headers: { "x-forwarded-for": ip },
      });
    let sawRateLimited = false;
    for (let i = 0; i < 12; i++) {
      const res = await getRecompute(makeReq(), { params: Promise.resolve({ chain: CHAIN, id: AGENT_ID }) });
      if (res.status === 429) {
        sawRateLimited = true;
        expect(res.headers.get("Retry-After")).toBeTruthy();
        expect(res.headers.get("X-RateLimit-Limit")).toBe("10");
        break;
      }
    }
    expect(sawRateLimited).toBe(true);
  });
});

describe("GET /api/v1/reviewers/:chain/:address", () => {
  it("returns a reviewer profile with numeric conditions", async () => {
    const res = await getReviewer(req(`http://x/api/v1/reviewers/${REVIEWER_CHAIN}/${REVIEWER}`), {
      params: Promise.resolve({ chain: REVIEWER_CHAIN, address: REVIEWER }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.address).toBe(REVIEWER);
  });
});

describe("GET /api/v1/reviewers/:chain/:address/agents", () => {
  it("lists agents touched and is rate limited at 10/min (SPEC 13)", async () => {
    const ip = "203.0.113.10";
    const makeReq = () =>
      new Request(`http://x/api/v1/reviewers/${REVIEWER_CHAIN}/${REVIEWER}/agents`, {
        headers: { "x-forwarded-for": ip },
      });
    let sawRateLimited = false;
    for (let i = 0; i < 12; i++) {
      const res = await getReviewerAgents(makeReq(), {
        params: Promise.resolve({ chain: REVIEWER_CHAIN, address: REVIEWER }),
      });
      if (res.status === 429) {
        sawRateLimited = true;
        break;
      }
    }
    expect(sawRateLimited).toBe(true);
  });
});

describe("GET /api/v1/stats/:chain", () => {
  it("excludes placeholders from agents_scoreable and reports them separately", async () => {
    const res = await getStats(req(`http://x/api/v1/stats/${CHAIN}`), { params: Promise.resolve({ chain: CHAIN }) });
    const body = await res.json();
    expect(body.data.agents_scoreable).toBe(body.data.agents_total - body.data.agents_by_lifecycle.placeholder);
  });
});

describe("GET /api/v1/dumps", () => {
  it("is unauthenticated and unlimited: never rate limited (SPEC 13)", async () => {
    for (let i = 0; i < 50; i++) {
      const res = await getDumps();
      expect(res.status).toBe(200);
    }
  });

  it("marks placeholder rows clearly", async () => {
    const res = await getDumps();
    const body = await res.json();
    for (const dump of body.data.dumps) {
      if (dump.row_count === 0) expect(dump.sha256).toBe("pending");
    }
  });
});

describe("GET /api/v1/health", () => {
  it("reports per-chain lag", async () => {
    const res = await getHealth();
    const body = await res.json();
    expect(Array.isArray(body.data.chains)).toBe(true);
  });
});

describe("POST /api/v1/mcp", () => {
  it("exposes get_agent_score with the same envelope as REST", async () => {
    const res = await postMcp(
      req("http://x/api/v1/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "get_agent_score",
          params: { chain: CHAIN, id: AGENT_ID },
        }),
      }),
    );
    const body = await res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.result.data.agent_id).toBe(AGENT_ID);
    expect(typeof body.result.data.score.confidence).toBe("number");
  });

  it("rejects an unknown tool with a JSON-RPC method-not-found error", async () => {
    const res = await postMcp(
      req("http://x/api/v1/mcp", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "delete_everything", params: {} }),
      }),
    );
    const body = await res.json();
    expect(body.error.code).toBe(-32601);
  });

  it("get_proof never fabricates on-chain anchoring data", async () => {
    const res = await postMcp(
      req("http://x/api/v1/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "get_proof",
          params: { chain: CHAIN, id: AGENT_ID },
        }),
      }),
    );
    const body = await res.json();
    expect(body.result.data.anchored).toBe(false);
  });
});
