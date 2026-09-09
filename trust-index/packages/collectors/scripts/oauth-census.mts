/**
 * Can we get a credential without a human?
 *
 * 2,713 of the 3,774 auth walls advertise RFC 9728 OAuth resource metadata. That
 * pointer names an authorization server, and the AS's own metadata says what it
 * will accept. Two fields decide whether this population is self-servable:
 *
 *   registration_endpoint    RFC 7591 Dynamic Client Registration — we can mint
 *                            a client_id with no human and no signup form.
 *   grant_types_supported    `client_credentials` is a machine-to-machine token:
 *                            no user, no consent screen, no account. That is the
 *                            unlock. `authorization_code` alone is NOT — it needs
 *                            a person to log in and approve, so DCR gets us a
 *                            client_id we cannot exchange for anything.
 *
 * Read-only: two well-known GETs per subject, no registration is attempted here.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { guardedFetch } from "../src/net.js";
import type { ProbeTranscript } from "../src/mcp/transcript.js";

const CONC = Number(process.argv.includes("--concurrency") ? process.argv[process.argv.indexOf("--concurrency")+1] : 32);
const targets: Array<{ name: string; endpoint: string; scheme: string }> = [];
for (const f of readdirSync("transcripts").filter((x) => x.endsWith(".json"))) {
  let t: ProbeTranscript & { auth?: { required?: boolean; scheme?: string | null } };
  try { t = JSON.parse(readFileSync(`transcripts/${f}`, "utf8")); } catch { continue; }
  if (t.auth?.required !== true) continue;
  targets.push({ name: f.replace(/\.json$/, ""), endpoint: t.endpoint, scheme: String(t.auth.scheme ?? "") });
}
console.log(`auth-walled subjects: ${targets.length}`);

const origin = (u: string): string => { try { const x = new URL(u); return `${x.protocol}//${x.host}`; } catch { return ""; } };
const getJson = async (url: string): Promise<Record<string, unknown> | null> => {
  const r = await guardedFetch(url, { timeoutMs: 10_000, headers: { accept: "application/json" } });
  if (!r.ok) return null;
  try { return JSON.parse(r.body) as Record<string, unknown>; } catch { return null; }
};

type Row = {
  name: string; endpoint: string; as_url: string | null;
  grants: string[]; has_dcr: boolean; token_auth: string[];
  self_servable: boolean; reason: string;
};
const out: Row[] = [];
let done = 0, dcr = 0, cc = 0, noMeta = 0;

const worker = async (): Promise<void> => {
  for (;;) {
    const t = targets.shift();
    if (t === undefined) return;
    const o = origin(t.endpoint);
    const row: Row = { name: t.name, endpoint: t.endpoint, as_url: null, grants: [], has_dcr: false, token_auth: [], self_servable: false, reason: "" };
    try {
      // The resource metadata names the AS; fall back to the resource origin,
      // which is what most of these servers actually are.
      const prm = await getJson(`${o}/.well-known/oauth-protected-resource`);
      const asList = Array.isArray(prm?.authorization_servers) ? (prm!.authorization_servers as string[]) : [];
      const asBase = (asList[0] ?? o).replace(/\/$/, "");
      row.as_url = asBase;
      const asm =
        (await getJson(`${asBase}/.well-known/oauth-authorization-server`)) ??
        (await getJson(`${asBase}/.well-known/openid-configuration`));
      if (asm === null) { row.reason = "no AS metadata"; noMeta++; }
      else {
        row.grants = Array.isArray(asm.grant_types_supported) ? (asm.grant_types_supported as string[]) : [];
        row.has_dcr = typeof asm.registration_endpoint === "string";
        row.token_auth = Array.isArray(asm.token_endpoint_auth_methods_supported) ? (asm.token_endpoint_auth_methods_supported as string[]) : [];
        if (row.has_dcr) dcr++;
        const hasCC = row.grants.some((g) => g === "client_credentials");
        if (hasCC) cc++;
        row.self_servable = hasCC && row.has_dcr;
        row.reason = hasCC ? (row.has_dcr ? "client_credentials + DCR: fully self-servable" : "client_credentials but no DCR: needs a client_id from somewhere")
          : row.grants.length === 0 ? "AS metadata states no grant types" : `only ${row.grants.join("/")}: needs a human to log in`;
      }
    } catch (e) { row.reason = `probe failed: ${String(e).slice(0, 60)}`; }
    out.push(row);
    done++;
    if (done % 250 === 0) console.error(`  ${done}  dcr=${dcr} client_credentials=${cc} no-meta=${noMeta}`);
  }
};
await Promise.all(Array.from({ length: CONC }, worker));
writeFileSync("oauth-census.json", JSON.stringify(out, null, 2));
const self = out.filter((r) => r.self_servable).length;
console.log(`\ntotal probed          ${out.length}`);
console.log(`AS metadata found     ${out.filter((r)=>r.grants.length>0||r.has_dcr).length}`);
console.log(`DCR (registration)    ${dcr}`);
console.log(`client_credentials    ${cc}`);
console.log(`FULLY SELF-SERVABLE   ${self}   <- credential obtainable with no human`);
console.log(`needs a human login   ${out.length - self}`);
