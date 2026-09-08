/**
 * Drive an MCP server's OAuth 2.1 flow once, and store the resulting token.
 *
 * WHY THIS IS A SCRIPT A HUMAN RUNS, and not something the harness does on a
 * schedule: the servers in this group issue tokens only through
 * `authorization_code`. That grant requires a person to sign in as themselves
 * and accept the vendor's terms. Creating that account is the account owner's
 * decision, not the harness's and not an agent's, so the irreducible human step
 * is the whole point of the design rather than an inconvenience in it. What the
 * script removes is everything AROUND that step — discovery, dynamic client
 * registration, PKCE, the callback listener, the token exchange, and the
 * encrypted write — which is otherwise an afternoon of RFC-reading per server.
 *
 * Storage is checked BEFORE the browser opens. Obtaining a token we cannot
 * store would mean a real credential printed to a terminal, and the one thing
 * this repo's credential module is built to prevent is a secret sitting
 * somewhere it was never encrypted.
 *
 * Usage:
 *   npx tsx scripts/obtain-oauth-credential.mts \
 *     --endpoint https://framethrower.ai/api/mcp \
 *     --subject-id ai.framethrower/framethrower \
 *     --i-have-approval
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createDb, putCredential } from "@trust-index/db";

const arg = (n: string, d: string): string => {
  const i = process.argv.indexOf(n);
  return i === -1 ? d : (process.argv[i + 1] ?? d);
};

const endpoint = arg("--endpoint", "");
const subjectId = arg("--subject-id", "");
const port = Number(arg("--port", "8765"));

if (endpoint === "" || subjectId === "") {
  console.log("--endpoint and --subject-id are required.");
  process.exit(1);
}

/**
 * The approval gate every third-party-touching script in this package carries.
 * Here it means more than elsewhere: past this line a real account is bound to
 * a real person and a vendor's terms are accepted.
 */
if (!process.argv.includes("--i-have-approval")) {
  console.log(
    "This opens a vendor sign-in page and creates or uses an account in YOUR name,\n" +
      "accepting that vendor's terms. Only the account owner can decide that.\n" +
      "Re-run with --i-have-approval once it is your decision to make.",
  );
  process.exit(0);
}

// Fail before the browser opens, not after a token is in hand.
const dbUrl = process.env.DATABASE_URL;
if (dbUrl === undefined || dbUrl === "") {
  console.error("DATABASE_URL is not set. Refusing to obtain a token that cannot be stored.");
  process.exit(1);
}
const credKey = process.env.TRUST_INDEX_CREDENTIAL_KEY;
if (credKey === undefined || credKey.length < 16) {
  console.error(
    "TRUST_INDEX_CREDENTIAL_KEY is not set (or is under 16 characters).\n" +
      "Refusing to obtain a token that cannot be encrypted at rest.",
  );
  process.exit(1);
}

const json = async (url: string, init?: RequestInit): Promise<any> => {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
};

/**
 * Discovery starts at the resource, not at a guessed well-known path: the
 * protected-resource document is what names the authorization server, and on
 * some deployments those are different origins.
 */
const origin = new URL(endpoint).origin;
const prm = await json(`${origin}/.well-known/oauth-protected-resource`);
const asUrl: string = prm.authorization_servers?.[0] ?? origin;
const as = await json(`${new URL(asUrl).origin}/.well-known/oauth-authorization-server`);

const grants: string[] = as.grant_types_supported ?? ["authorization_code"];

/**
 * If a machine grant exists, take it — no human, no account, no terms. Almost
 * none of this cohort offers one, but checking costs a branch and the payoff is
 * a credential nobody has to be asked for.
 */
if (grants.includes("client_credentials")) {
  console.log("Server supports client_credentials; no human sign-in needed.");
}

const scope: string = arg("--scope", (as.scopes_supported ?? ["openid"]).join(" "));

// Dynamic client registration (RFC 7591): anonymous, holds no personal data,
// and is how the MCP spec expects any client to bootstrap.
const redirectUri = `http://localhost:${port}/callback`;
const reg = await json(as.registration_endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    client_name: "trust-index probe",
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope,
  }),
});
const clientId: string = reg.client_id;

// PKCE S256. The verifier never leaves this process until the exchange.
const verifier = randomBytes(32).toString("hex");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const state = randomBytes(16).toString("hex");

const authUrl = new URL(as.authorization_endpoint);
for (const [k, v] of Object.entries({
  response_type: "code",
  client_id: clientId,
  redirect_uri: redirectUri,
  scope,
  state,
  code_challenge: challenge,
  code_challenge_method: "S256",
})) authUrl.searchParams.set(k, v);

console.log(`\nOpen this in a browser and sign in:\n\n${authUrl.toString()}\n`);
console.log(`Waiting for the callback on ${redirectUri} ...`);

const code = await new Promise<string>((resolve, reject) => {
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? "/", `http://localhost:${port}`);
    if (u.pathname !== "/callback") { res.writeHead(404).end(); return; }
    const got = u.searchParams.get("code");
    const err = u.searchParams.get("error");
    // Reject a mismatched state rather than exchanging it: this is the one
    // check that keeps someone else's authorization from landing in our store.
    if (u.searchParams.get("state") !== state) {
      res.writeHead(400).end("state mismatch");
      server.close(); reject(new Error("state mismatch")); return;
    }
    res.writeHead(200, { "content-type": "text/plain" })
      .end(err !== null ? `Authorization failed: ${err}` : "Authorized. You can close this tab.");
    server.close();
    if (got === null) reject(new Error(err ?? "no code returned")); else resolve(got);
  });
  server.listen(port);
  setTimeout(() => { server.close(); reject(new Error("timed out after 5 minutes")); }, 300_000);
});

const tokenRes = await fetch(as.token_endpoint, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  }),
});
if (!tokenRes.ok) {
  console.error(`Token exchange failed: HTTP ${tokenRes.status} ${(await tokenRes.text()).slice(0, 300)}`);
  process.exit(1);
}
const tok = (await tokenRes.json()) as {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
};
const accessToken: string = tok.access_token;

/**
 * Verify against userinfo rather than a real tool call. A tools/call would be
 * the more complete proof, but on a metered server it spends the account's
 * credits to learn something userinfo answers for free — and those credits are
 * the allowance the assessment run itself needs.
 */
let accountRef: string | null = null;
if (typeof as.userinfo_endpoint === "string") {
  try {
    const who = await json(as.userinfo_endpoint, { headers: { authorization: `Bearer ${accessToken}` } });
    accountRef = who.email ?? who.sub ?? null;
  } catch (e) {
    console.error(`Warning: token obtained but userinfo failed: ${(e as Error).message}`);
  }
}

const expiresAt = typeof tok.expires_in === "number" ? new Date(Date.now() + tok.expires_in * 1000) : null;

const { db, close } = createDb(dbUrl);
try {
  await putCredential(db, {
    endpoint,
    subject_id: subjectId,
    scheme: "bearer",
    secret: accessToken,
    tier: "free",
    quota_note: arg("--quota-note", "") === "" ? null : arg("--quota-note", ""),
    expires_at: expiresAt,
    obtained_via: "OAuth 2.1 authorization_code + PKCE, dynamic client registration, human sign-in",
    account_ref: accountRef,
    // Recorded because it is a real limitation, not an incidental detail: the
    // store has ONE secret slot and applyCredential sends it as the bearer, so
    // a refresh token has nowhere to live. When this access token expires the
    // row goes stale and a human re-runs this script. staleCredentials() is
    // what surfaces that before a run mistakes it for the subject's failure.
    notes:
      typeof tok.refresh_token === "string"
        ? "Server issued a refresh token; the schema has no slot for it. Re-run this script on expiry."
        : null,
  });
  console.log(`\nStored credential for ${endpoint}${accountRef === null ? "" : ` (account: ${accountRef})`}.`);
  console.log(expiresAt === null ? "No stated expiry." : `Expires ${expiresAt.toISOString()}.`);
} finally {
  await close();
}
