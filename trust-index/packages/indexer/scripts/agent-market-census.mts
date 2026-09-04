/**
 * How big is the agent market, and how much of it can be enumerated?
 *
 * Everything measured in this repository so far is on-chain, and that
 * population turned out to be tiny: roughly 232 callable agents in a 600-agent
 * sample of ERC-8004, 58 Olas mechs, 12 active ACP providers. Before building
 * anything further, the question is whether the off-chain population is bigger
 * and, critically, whether it is enumerable. A market you cannot list is one
 * you cannot rate.
 *
 * A distinction this script keeps that an earlier analysis lost: an MCP server
 * is a TOOL PROVIDER with no judgement of its own, and an agent has a model in
 * the loop that plans and decides. They need different tests and have different
 * buyers. Both are counted here, separately and labelled, because both are
 * candidate populations and conflating them produced a wrong answer once
 * already.
 *
 * Sources are recorded as enumerable or not. "Requires an API key" and "no
 * public API" are findings, not failures: a directory that cannot be listed
 * without a commercial relationship is a different proposition from one that
 * can, and that difference decides whether an independent rater can cover it.
 *
 * Usage:
 *   pnpm --filter @trust-index/indexer exec tsx scripts/agent-market-census.mts \
 *     [--max <n>] [--out <file>]
 */
import { writeFileSync } from "node:fs";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const MAX = Number(arg("--max", "6000"));
const OUT = arg("--out", "");

type SourceResult = {
  source: string;
  kind: "tool provider" | "agent" | "mixed";
  enumerable: boolean;
  note: string;
  total: number | null;
  callable: number | null;
  detail: Record<string, number>;
};

async function getJson(url: string, timeoutMs = 25_000): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Official MCP registry. Cursor-paginated, no key. Counts servers and, more
 * usefully, how many expose a remote endpoint: a server that must be installed
 * locally cannot be exercised by a third party at all, so remotes are the
 * ceiling on what an independent rater could test without cooperation.
 */
async function mcpRegistry(): Promise<SourceResult> {
  const detail: Record<string, number> = {};
  // The registry lists every VERSION of a server as its own row, so counting
  // rows overstates the population by roughly threefold. A first pass reported
  // 90,152 "servers" where there are 26,907 distinct ones. Servers are counted
  // by name; rows are reported alongside so the difference is visible rather
  // than hidden.
  const names = new Set<string>();
  const namesWithRemotes = new Set<string>();
  let rows = 0;
  let cursor: string | null = null;
  let truncated = false;
  try {
    // Page cap derived from --max rather than hardcoded. A fixed 200-page limit
    // silently produced "exactly 20,000 servers", which is 200 pages of 100 and
    // a property of this loop rather than of the registry. Round numbers from a
    // paginated source deserve suspicion.
    const maxPages = Math.ceil(MAX / 100) + 1;
    for (let page = 0; page < maxPages; page += 1) {
      const url = `https://registry.modelcontextprotocol.io/v0/servers?limit=100${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
      const body = (await getJson(url)) as {
        servers?: Array<{ server?: { name?: string; remotes?: unknown[]; packages?: unknown[] } }>;
        metadata?: { nextCursor?: string };
      };
      const page_rows = body.servers ?? [];
      if (page_rows.length === 0) break;
      for (const r of page_rows) {
        rows += 1;
        const name = r.server?.name;
        if (name === undefined) continue;
        names.add(name);
        const remotes = r.server?.remotes;
        // A server counts as remotely callable if ANY of its versions exposes
        // a remote, since that is the version a third party would exercise.
        if (Array.isArray(remotes) && remotes.length > 0) namesWithRemotes.add(name);
      }
      cursor = body.metadata?.nextCursor ?? null;
      if (cursor === null) {
        detail["enumeration"] = 1; // reached the true end of the registry
        break;
      }
      if (rows >= MAX) {
        truncated = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    delete detail["enumeration"];
    detail["version rows returned"] = rows;
    detail["distinct servers"] = names.size;
    detail["servers exposing a remote endpoint"] = namesWithRemotes.size;
    detail["servers install-only"] = names.size - namesWithRemotes.size;
    return {
      source: "Official MCP registry",
      kind: "tool provider",
      enumerable: true,
      note: truncated
        ? `TRUNCATED at the --max row limit of ${MAX}; the registry has more. This is a floor, not a total.`
        : "Cursor-paginated, no API key, enumerated to the end with no duplicate rows. Counted by distinct server name, not by version row. Remotes are the subset a third party could exercise without installing anything.",
      total: names.size,
      callable: namesWithRemotes.size,
      detail,
    };
  } catch (err) {
    return {
      source: "Official MCP registry",
      kind: "tool provider",
      enumerable: false,
      note: `enumeration failed after ${rows} rows: ${err instanceof Error ? err.message : String(err)}`,
      total: names.size > 0 ? names.size : null,
      callable: null,
      detail,
    };
  }
}

/**
 * Hugging Face Spaces. Public and paginated, but overwhelmingly demos and
 * course exercises rather than deployed agents, so the raw count would badly
 * overstate the market. Counted here with a like-count filter as a crude
 * seriousness proxy, and reported as mixed rather than as agents.
 */
async function huggingFaceSpaces(): Promise<SourceResult> {
  const detail: Record<string, number> = {};
  let total = 0;
  let liked = 0;
  try {
    for (const q of ["agent", "assistant", "autonomous"]) {
      const rows = (await getJson(`https://huggingface.co/api/spaces?search=${q}&limit=100`)) as Array<{
        likes?: number;
      }>;
      total += rows.length;
      for (const r of rows) if ((r.likes ?? 0) >= 5) liked += 1;
      detail[`matching "${q}" (first page)`] = rows.length;
      await new Promise((r) => setTimeout(r, 150));
    }
    detail["with 5 or more likes"] = liked;
    return {
      source: "Hugging Face Spaces",
      kind: "mixed",
      enumerable: true,
      note: "Public and paginated. Dominated by demos, course templates and hackathon entries; the raw count overstates deployed agents by a wide margin.",
      total,
      callable: liked,
      detail,
    };
  } catch (err) {
    return {
      source: "Hugging Face Spaces",
      kind: "mixed",
      enumerable: false,
      note: err instanceof Error ? err.message : String(err),
      total: null,
      callable: null,
      detail,
    };
  }
}

/** Directories checked for a public listing API. */
const CLOSED: Array<{ source: string; kind: SourceResult["kind"]; url: string; note: string }> = [
  { source: "Glama MCP directory", kind: "tool provider", url: "https://glama.ai/api/mcp/v1/servers?first=1", note: "" },
  { source: "Smithery", kind: "tool provider", url: "https://smithery.ai/api/servers?page=1&pageSize=1", note: "" },
  { source: "mcp.so", kind: "tool provider", url: "https://mcp.so/api/servers?page=1", note: "" },
];

async function checkClosed(): Promise<SourceResult[]> {
  const out: SourceResult[] = [];
  for (const c of CLOSED) {
    let note = "";
    let enumerable = false;
    try {
      const res = await fetch(c.url, { signal: AbortSignal.timeout(20_000), headers: { accept: "application/json" } });
      const text = (await res.text()).slice(0, 120);
      if (res.ok && text.trimStart().startsWith("{")) {
        enumerable = true;
        note = `HTTP ${res.status}, returns JSON`;
      } else if (res.status === 401 || res.status === 403) {
        note = `HTTP ${res.status}: requires an API key, so independent enumeration needs a commercial relationship`;
      } else {
        note = `HTTP ${res.status}: no public listing API at the documented path`;
      }
    } catch (err) {
      note = `unreachable: ${err instanceof Error ? err.message : String(err)}`;
    }
    out.push({ source: c.source, kind: c.kind, enumerable, note, total: null, callable: null, detail: {} });
    await new Promise((r) => setTimeout(r, 150));
  }
  return out;
}

async function main(): Promise<void> {
  const results: SourceResult[] = [];
  console.error("enumerating official MCP registry...");
  results.push(await mcpRegistry());
  console.error("sampling Hugging Face Spaces...");
  results.push(await huggingFaceSpaces());
  console.error("checking closed directories...");
  results.push(...(await checkClosed()));

  // Measured elsewhere in this repository, carried here so the comparison is
  // in one place. See research/real-cohort-coverage.md and
  // research/commerce-linkage-feasibility.md.
  const onChain: SourceResult[] = [
    {
      source: "ERC-8004 registry (Base)",
      kind: "agent",
      enumerable: true,
      note: "Fully public on chain. 84,617 registered, but 77 percent share a wallet and a 600-agent sample found 232 publishing a callable endpoint.",
      total: 84617,
      callable: 232,
      detail: { "sampled for callability": 600 },
    },
    {
      source: "ERC-8004, all 12 chains",
      kind: "agent",
      enumerable: true,
      note: "Base is the only chain of twelve with any observed feedback activity.",
      total: 486745,
      callable: null,
      detail: {},
    },
    {
      source: "Olas Mech Marketplace (Base)",
      kind: "agent",
      enumerable: true,
      note: "51 mechs created, 23 with delivery outcomes. Real outcome data, tiny population.",
      total: 51,
      callable: 23,
      detail: {},
    },
    {
      source: "Virtuals ACP v2 (Base)",
      kind: "agent",
      enumerable: true,
      note: "1,924 jobs in twelve days from 12 distinct providers.",
      total: 12,
      callable: 12,
      detail: {},
    },
  ];
  results.push(...onChain);

  const lines: string[] = [];
  lines.push("# Agent market census");
  lines.push("");
  lines.push("What exists, and what can be enumerated without a commercial relationship.");
  lines.push("");
  lines.push("| Source | Kind | Enumerable | Listed | Callable or serious |");
  lines.push("|---|---|---|---|---|");
  for (const r of results) {
    lines.push(
      `| ${r.source} | ${r.kind} | ${r.enumerable ? "yes" : "no"} | ${r.total ?? "-"} | ${r.callable ?? "-"} |`,
    );
  }
  lines.push("");
  lines.push("## Notes per source");
  lines.push("");
  for (const r of results) {
    lines.push(`**${r.source}** (${r.kind}). ${r.note}`);
    const d = Object.entries(r.detail);
    if (d.length > 0) lines.push(`  ${d.map(([k, v]) => `${k}: ${v}`).join("; ")}`);
    lines.push("");
  }
  const text = lines.join("\n");
  console.log(text);
  if (OUT !== "") {
    writeFileSync(OUT, `${text}\n`);
    console.error(`wrote ${OUT}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
