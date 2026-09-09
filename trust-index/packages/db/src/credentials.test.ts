/**
 * Rotating OAuth credentials.
 *
 * These pin the failure FrameThrower exposed: its refresh tokens rotate, the
 * schema had one secret column, and the only survivable thing to store was a
 * refresh token that `applyCredential` would then send as a bearer. The 401
 * that came back is indistinguishable from the subject refusing us — so our
 * expired token would have been published as their availability failure.
 */
import { describe, expect, it } from "vitest";
import { applyCredential, StaleSecretError, type ResolvedCredential } from "./credentials.js";

const cred = (over: Partial<ResolvedCredential> = {}): ResolvedCredential => ({
  endpoint: "https://framethrower.ai/api/mcp",
  scheme: "bearer",
  param_name: null,
  secret: "access-token",
  refresh: null,
  refresh_rotates: false,
  secret_expires_at: null,
  mint: null,
  tier: "free",
  quota_note: null,
  ...over,
});

describe("applyCredential", () => {
  it("attaches a bearer token", () => {
    const { headers } = applyCredential(cred(), {});
    expect(headers.authorization).toBe("Bearer access-token");
  });

  it("attaches a named header", () => {
    const { headers } = applyCredential(cred({ scheme: "header", param_name: "x-api-key", secret: "k" }), {});
    expect(headers["x-api-key"]).toBe("k");
  });

  it("REFUSES to send a secret that has expired, rather than earning a 401", () => {
    // The whole point. A 401 from our stale token reads exactly like the
    // subject refusing us, and would be scored against them.
    const stale = cred({ secret_expires_at: new Date(Date.now() - 1000), refresh: "r", refresh_rotates: true });
    expect(() => applyCredential(stale, {})).toThrow(StaleSecretError);
    try {
      applyCredential(stale, {});
    } catch (e) {
      expect((e as Error).message).toMatch(/redeem `refresh`/);
    }
  });

  it("says so differently when there is no way to recover", () => {
    const dead = cred({ secret_expires_at: new Date(Date.now() - 1000), refresh: null });
    expect(() => applyCredential(dead, {})).toThrow(/no refresh token to mint a new one/);
  });

  it("still sends a secret that has not expired yet", () => {
    const fresh = cred({ secret_expires_at: new Date(Date.now() + 60_000) });
    expect(applyCredential(fresh, {}).headers.authorization).toBe("Bearer access-token");
  });

  it("keeps what you PRESENT separate from what you REDEEM", () => {
    // A rotating refresh token must never go out on the wire as the secret.
    const pair = cred({ secret: "access", refresh: "refresh", refresh_rotates: true });
    const { headers } = applyCredential(pair, {});
    expect(headers.authorization).toBe("Bearer access");
    expect(JSON.stringify(headers)).not.toContain("refresh");
  });
});
