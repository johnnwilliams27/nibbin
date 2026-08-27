/**
 * Construction and env-var resolution only. No test here makes a network
 * call: no chain RPC is reachable in this build environment (see
 * docs/NOTES-track-a.md). ChainSource behavior itself is exercised
 * exhaustively via SimulatedChainSource elsewhere in this package.
 */
import { describe, expect, it } from "vitest";
import { resolveRpcUrl, ViemChainSource, ViemChainSourceConfigError } from "./viemChainSource.js";

describe("resolveRpcUrl", () => {
  it("returns the env var value when set", () => {
    expect(resolveRpcUrl("RPC_URL_BASE", { RPC_URL_BASE: "https://rpc.example/base" })).toBe(
      "https://rpc.example/base",
    );
  });

  it("throws a config error when the env var is unset", () => {
    expect(() => resolveRpcUrl("RPC_URL_BASE", {})).toThrow(ViemChainSourceConfigError);
  });

  it("throws a config error when the env var is set but empty", () => {
    expect(() => resolveRpcUrl("RPC_URL_BASE", { RPC_URL_BASE: "" })).toThrow(ViemChainSourceConfigError);
  });
});

describe("ViemChainSource construction", () => {
  it("constructs without making a network call", () => {
    const url = resolveRpcUrl("RPC_URL_BASE", { RPC_URL_BASE: "https://rpc.example/base" });
    expect(() => new ViemChainSource(url, 8453)).not.toThrow();
  });
});
