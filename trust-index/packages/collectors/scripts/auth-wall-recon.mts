/**
 * What is behind each auth wall, and is there a door an agent can open?
 *
 * 259 of the 600 stored transcripts record a server that refused the
 * `initialize` handshake outright. The auth triage detailed 49 servers, and not
 * one of them is in that set — the 49 are all servers whose HANDSHAKE was open
 * and whose TOOLS were walled. So the 259 have never been assessed at all: we
 * do not know which are free-key servers a human could unlock in a minute and
 * which are dead ends, and a compendium that cannot say which is which is
 * reporting our reach as their quality.
 *
 * This gathers the facts a triage needs, and only the facts. It creates no
 * account, submits no form, enters no email and accepts no terms — those are
 * the account owner's to do, one agent per service, and a duplicate signup is
 * exactly what must not happen. Everything here is a GET or an unauthenticated
 * MCP handshake.
 *
 * Per subject, at most three requests, spaced, and the well-knowns deduplicated
 * by origin because a dozen of these servers share one gateway host:
 *
 *   1. `initialize` again — not to re-measure the wall, which is recorded, but
 *      to read what the server SAYS. net.ts used to discard the body and the
 *      headers of a non-2xx, so the operator's own error copy — which is where
 *      the signup URL, the free tier and the scheme are written — never reached
 *      a transcript. That is fixed; this collects what was being thrown away.
 *   2. `/.well-known/oauth-protected-resource` (RFC 9728)
 *   3. `/.well-known/oauth-authorization-server` (RFC 8414)
 *
 * The third is the one that decides the hardest question, and the lesson is
 * CreativeScope's: a working RFC 7591 dynamic client registration endpoint is
 * NOT a credential. It issues a client, not an account, and without a machine
 * grant type it gets you exactly as far as the login page. So
 * `grant_types_supported` is read and reported directly — `client_credentials`
 * present is the only shape that means an agent could ever finish the flow
 * alone.
 *
 * Usage:
 *   pnpm exec tsx scripts/auth-wall-recon.mts --i-have-approval [--limit 40] [--out auth-wall-recon.json]
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { handshakeWalled } from "../src/mcp/auth.js";
import { jitteredSpacing, probeIdentity } from "../src/mcp/probe-identity.js";
import { guardedFetch } from "../src/net.js";
import type { ProbeTranscript } from "../src/mcp/transcript.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}
const dir = arg("--transcripts", "transcripts");
const outFile = arg("--out", "auth-wall-recon.json");
const limit = Number(arg("--limit", "1000"));
const only = arg("--only", "");

if (!process.argv.includes("--i-have-approval")) {
  console.log("This makes unauthenticated requests to third-party servers. Re-run with --i-have-approval.");
  process.exit(0);
}

export type Recon = {
  id: string;
  endpoint: string;
  status: number | null;
  description: string | null;
  repository_url: string | null;
  /** Verbatim, capped. The operator's own words about their wall. */
  wall_body: string | null;
  /** The `WWW-Authenticate` challenge, if any. Scheme, realm, RFC 9728 pointer. */
  challenge: string | null;
  /** Did the re-probe still refuse us, and with what? Never trusted from one attempt. */
  reprobe: string | null;
  protected_resource: { found: boolean; authorization_servers: string[]; scopes: string[] } | null;
  authorization_server: {
    found: boolean;
    issuer: string | null;
    registration_endpoint: string | null;
    grant_types_supported: string[];
    /** The whole question: can a machine finish this flow, or does it end at a login page? */
    machine_grant: boolean;
  } | null;
  /** Every http(s) URL the server named in its own refusal. Signup pages live here. */
  urls_named: string[];
};

const subjects: Array<{ id: string; t: ProbeTranscript }> = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => ({ id: f.replace(/\.json$/, ""), t: JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as ProbeTranscript }))
  // `--only` takes a comma-separated list of substrings, so a corrected pass can
  // redo the handful of rows a fix actually changes rather than the whole 259.
  .filter(({ id, t }) => handshakeWalled(t) && (only === "" || only.split(",").some((s) => id.includes(s.trim()))))
  .slice(0, limit);

console.log(`${subjects.length} handshake-walled subjects`);

/** One fetch of a well-known per ORIGIN, however many subjects share it. */
const wellKnownCache = new Map<string, unknown | null>();
async function wellKnown(origin: string, path: string): Promise<Record<string, unknown> | null> {
  const url = `${origin}${path}`;
  if (wellKnownCache.has(url)) return wellKnownCache.get(url) as Record<string, unknown> | null;
  const res = await guardedFetch(url, { timeoutMs: 10_000, headers: { accept: "application/json" } });
  let parsed: Record<string, unknown> | null = null;
  if (res.ok) {
    try {
      const j = JSON.parse(res.body) as unknown;
      if (typeof j === "object" && j !== null) parsed = j as Record<string, unknown>;
    } catch {
      /* an HTML 200 is a soft 404 on most hosts; not a document */
    }
  }
  wellKnownCache.set(url, parsed);
  return parsed;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const URL_IN_PROSE = /https?:\/\/[^\s"'`<>)\]},]{4,120}/g;

async function handshake(endpoint: string, ua: string): Promise<{ status: number | null; body: string | null; challenge: string | null; reason: string }> {
  const res = await guardedFetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      "user-agent": ua,
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mcp-client", version: "1.0.0" } },
    }),
    timeoutMs: 12_000,
  });
  if (res.ok) return { status: res.status, body: res.body.slice(0, 1_500), challenge: null, reason: "answered" };
  return {
    status: res.status,
    body: res.body === undefined ? null : res.body.slice(0, 1_500),
    challenge: res.headers?.get("www-authenticate") ?? null,
    reason: res.reason,
  };
}

const out: Recon[] = [];
for (const { id, t } of subjects) {
  await new Promise((r) => setTimeout(r, jitteredSpacing(700)));
  const ua = probeIdentity(id).userAgent;
  const origin = (() => {
    try {
      return new URL(t.endpoint).origin;
    } catch {
      return null;
    }
  })();

  // Two attempts before anything is called unreachable. This sandbox's egress
  // is flaky and a single failed connection has been misread as a fact about
  // somebody's server more than once in this repository.
  let hs = await handshake(t.endpoint, ua);
  if (hs.status === null) {
    await new Promise((r) => setTimeout(r, 2_500));
    hs = await handshake(t.endpoint, ua);
  }

  let pr: Recon["protected_resource"] = null;
  let as: Recon["authorization_server"] = null;
  if (origin !== null) {
    // RFC 9728 puts the resource identifier's PATH into the well-known URL —
    // `https://host/.well-known/oauth-protected-resource/mcp`, not the bare
    // root — and a spec-compliant server hands you the exact location in its
    // `WWW-Authenticate` challenge. Guessing the root missed every server that
    // scopes it, which was most of the ones that publish it at all. Follow the
    // pointer the server gave; fall back to the root only when it gave none.
    const pointer = /resource_metadata="?([^",]+)"?/i.exec(hs.challenge ?? "")?.[1] ?? null;
    const prDoc = pointer === null
      ? await wellKnown(origin, "/.well-known/oauth-protected-resource")
      : await wellKnown(pointer, "");
    pr = prDoc === null
      ? { found: false, authorization_servers: [], scopes: [] }
      : { found: true, authorization_servers: strings(prDoc.authorization_servers), scopes: strings(prDoc.scopes_supported) };
    // Ask the authorization server the protected-resource document names, when
    // it names one; otherwise the endpoint's own origin. An issuer with a path
    // takes the RFC 8414 path-insertion form, which is why the well-known
    // segment goes after the origin and before the issuer's path.
    const asBase = (pr.authorization_servers[0] ?? origin).replace(/\/$/, "");
    let asDoc = await wellKnown(asBase, "/.well-known/oauth-authorization-server");
    if (asDoc === null) {
      try {
        const u = new URL(asBase);
        if (u.pathname !== "/" && u.pathname !== "") {
          asDoc = await wellKnown(u.origin, `/.well-known/oauth-authorization-server${u.pathname}`);
        }
      } catch {
        /* asBase was not a URL; the fallback simply does not apply */
      }
    }
    if (asDoc === null) {
      as = { found: false, issuer: null, registration_endpoint: null, grant_types_supported: [], machine_grant: false };
    } else {
      const grants = strings(asDoc.grant_types_supported);
      as = {
        found: true,
        issuer: typeof asDoc.issuer === "string" ? asDoc.issuer : null,
        registration_endpoint: typeof asDoc.registration_endpoint === "string" ? asDoc.registration_endpoint : null,
        grant_types_supported: grants,
        machine_grant: grants.some((g) => g === "client_credentials" || g.includes("device_code") || g.includes("jwt-bearer")),
      };
    }
  }

  const prose = `${hs.body ?? ""} ${hs.challenge ?? ""}`;
  out.push({
    id,
    endpoint: t.endpoint,
    status: hs.status,
    description: t.registry?.description ?? null,
    repository_url: t.registry?.repository_url ?? null,
    wall_body: hs.body,
    challenge: hs.challenge,
    reprobe: hs.reason,
    protected_resource: pr,
    authorization_server: as,
    urls_named: [...new Set(prose.match(URL_IN_PROSE) ?? [])].slice(0, 8),
  });
  const flag = as?.machine_grant === true ? "MACHINE-GRANT" : as?.found === true ? "oauth" : pr?.found === true ? "rfc9728" : "";
  console.log(`  ${id.padEnd(46)} ${String(hs.status ?? "-").padEnd(5)} ${flag.padEnd(14)} ${(hs.body ?? "").replace(/\s+/g, " ").slice(0, 90)}`);
  writeFileSync(outFile, JSON.stringify(out, null, 2));
}

console.log(`\nwrote ${out.length} rows to ${outFile}`);
console.log(`RFC 9728 protected-resource documents: ${out.filter((o) => o.protected_resource?.found).length}`);
console.log(`RFC 8414 authorization-server documents: ${out.filter((o) => o.authorization_server?.found).length}`);
console.log(`of those, with a machine grant type: ${out.filter((o) => o.authorization_server?.machine_grant).length}`);
console.log(`servers that named a URL in their refusal: ${out.filter((o) => o.urls_named.length > 0).length}`);
console.log(`servers that did not answer this pass (unmeasured, not unreachable): ${out.filter((o) => o.status === null).length}`);
