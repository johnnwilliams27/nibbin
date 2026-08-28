import { describe, expect, it } from "vitest";
import { resolveMetadata, type FetchResult, type Fetcher } from "./metadata.js";

const GATEWAY = "https://gw.invalid/ipfs/";

function okJson(body: unknown, byteLength?: number): Fetcher {
  const json = JSON.stringify(body);
  return async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => {
      const bytes = new TextEncoder().encode(json);
      return byteLength !== undefined ? new ArrayBuffer(byteLength) : bytes.buffer;
    },
  });
}

const VALID_METADATA = {
  name: "agent-1",
  description: "a test agent",
  services: [{ type: "web", endpoint: "https://agent.invalid" }],
  x402Support: false,
  active: true,
  supportedTrust: ["feedback"],
};

describe("resolveMetadata", () => {
  it("returns absent for a null or empty token URI", async () => {
    const opts = { gatewayUrl: GATEWAY, timeoutMs: 1000, maxBytes: 1000, fetcher: okJson(VALID_METADATA) };
    expect(await resolveMetadata(null, opts)).toEqual({ status: "absent" });
    expect(await resolveMetadata("  ", opts)).toEqual({ status: "absent" });
  });

  it("resolves valid ipfs:// metadata through the gateway", async () => {
    let requestedUrl = "";
    const fetcher: Fetcher = async (url) => {
      requestedUrl = url;
      return okJson(VALID_METADATA)(url, { signal: new AbortController().signal });
    };
    const result = await resolveMetadata("ipfs://bafyCID123/meta.json", {
      gatewayUrl: GATEWAY,
      timeoutMs: 1000,
      maxBytes: 10_000,
      fetcher,
    });
    expect(requestedUrl).toBe("https://gw.invalid/ipfs/bafyCID123/meta.json");
    expect(result).toEqual({ status: "resolved", data: VALID_METADATA, cid: "bafyCID123" });
  });

  it("resolves a plain https:// token URI directly, bypassing the gateway", async () => {
    let requestedUrl = "";
    const fetcher: Fetcher = async (url) => {
      requestedUrl = url;
      return okJson(VALID_METADATA)(url, { signal: new AbortController().signal });
    };
    await resolveMetadata("https://agent.invalid/meta.json", {
      gatewayUrl: GATEWAY,
      timeoutMs: 1000,
      maxBytes: 10_000,
      fetcher,
    });
    expect(requestedUrl).toBe("https://agent.invalid/meta.json");
  });

  it("is malformed for an unsupported URI scheme", async () => {
    const result = await resolveMetadata("magnet:?xt=x", {
      gatewayUrl: GATEWAY,
      timeoutMs: 1000,
      maxBytes: 1000,
      fetcher: okJson(VALID_METADATA),
    });
    expect(result.status).toBe("malformed");
  });

  it("is unreachable when the fetcher throws (network error, DNS failure)", async () => {
    const fetcher: Fetcher = async () => {
      throw new Error("ECONNREFUSED");
    };
    const result = await resolveMetadata("ipfs://cid", { gatewayUrl: GATEWAY, timeoutMs: 1000, maxBytes: 1000, fetcher });
    expect(result).toMatchObject({ status: "unreachable" });
  });

  it("is unreachable on a non-2xx HTTP status, never a negative signal", async () => {
    const fetcher: Fetcher = async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) });
    const result = await resolveMetadata("ipfs://cid", { gatewayUrl: GATEWAY, timeoutMs: 1000, maxBytes: 1000, fetcher });
    expect(result).toEqual({ status: "unreachable", reason: "HTTP 404" });
  });

  it("is unreachable on timeout (aborted before the fetcher resolves)", async () => {
    const fetcher: Fetcher = (_url, init) =>
      new Promise<FetchResult>((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const result = await resolveMetadata("ipfs://cid", { gatewayUrl: GATEWAY, timeoutMs: 5, maxBytes: 1000, fetcher });
    expect(result).toMatchObject({ status: "unreachable" });
  });

  it("is malformed when the response exceeds the byte cap", async () => {
    const fetcher = okJson(VALID_METADATA, 300_000);
    const result = await resolveMetadata("ipfs://cid", { gatewayUrl: GATEWAY, timeoutMs: 1000, maxBytes: 256_000, fetcher });
    expect(result).toMatchObject({ status: "malformed" });
  });

  it("is malformed on invalid JSON", async () => {
    const fetcher: Fetcher = async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode("{not json").buffer,
    });
    const result = await resolveMetadata("ipfs://cid", { gatewayUrl: GATEWAY, timeoutMs: 1000, maxBytes: 1000, fetcher });
    expect(result).toMatchObject({ status: "malformed", reason: "not valid JSON" });
  });

  it("is malformed when required schema fields are missing", async () => {
    const fetcher = okJson({ name: "agent-1" });
    const result = await resolveMetadata("ipfs://cid", { gatewayUrl: GATEWAY, timeoutMs: 1000, maxBytes: 1000, fetcher });
    expect(result).toMatchObject({ status: "malformed" });
  });

  describe("SSRF and size guards (adversarial regression)", () => {
    const boom: Fetcher = async () => {
      throw new Error("fetcher must not be called for a blocked host");
    };

    it("blocks private, loopback, link-local, and cloud-metadata hosts without fetching", async () => {
      const opts = { gatewayUrl: GATEWAY, timeoutMs: 1000, maxBytes: 1000, fetcher: boom };
      for (const uri of [
        "http://169.254.169.254/latest/meta-data/",
        "http://localhost:8545/",
        "http://127.0.0.1/x",
        "http://10.0.0.5/x",
        "http://192.168.1.1/x",
        "http://[::1]/x",
        "http://172.16.0.1/x",
      ]) {
        const result = await resolveMetadata(uri, opts);
        expect(result.status === "unreachable" || result.status === "malformed").toBe(true);
      }
    });

    it("blocks a non-http(s) resolved scheme", async () => {
      const result = await resolveMetadata("file:///etc/passwd", {
        gatewayUrl: GATEWAY,
        timeoutMs: 1000,
        maxBytes: 1000,
        fetcher: boom,
      });
      expect(result).toMatchObject({ status: "malformed" });
    });

    it("still resolves a public gateway host", async () => {
      const result = await resolveMetadata("ipfs://cid", {
        gatewayUrl: GATEWAY,
        timeoutMs: 1000,
        maxBytes: 256_000,
        fetcher: okJson(VALID_METADATA),
      });
      expect(result.status).toBe("resolved");
    });

    it("rejects on a Content-Length over the cap before buffering", async () => {
      const fetcher: Fetcher = async () => ({
        ok: true,
        status: 200,
        headers: { get: (n) => (n.toLowerCase() === "content-length" ? "999999" : null) },
        arrayBuffer: async () => {
          throw new Error("body must not be buffered when Content-Length already exceeds the cap");
        },
      });
      const result = await resolveMetadata("ipfs://cid", { gatewayUrl: GATEWAY, timeoutMs: 1000, maxBytes: 1000, fetcher });
      expect(result).toMatchObject({ status: "malformed" });
    });
  });
});
