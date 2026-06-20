/**
 * safeFetch — the deny-by-default egress proxy every outbound request in this
 * package goes through (SPEC §6.5 SSRF guards, §6.9, docs/RISKS.md §2).
 *
 * Guarantees, in order of evaluation:
 *  - https only (no plaintext, no exotic schemes), default port only
 *  - no userinfo in URLs
 *  - host allowlist for A/H connectors; generic rails get any *public* host
 *  - every DNS answer must be a public unicast IP; the TCP connect is pinned
 *    to a validated address (DNS rebinding between check and connect cannot
 *    retarget the request)
 *  - credentials never travel to hosts they weren't issued for: Authorization/
 *    Cookie are rejected unless the target host is explicitly entitled to them
 *  - manual redirect handling: each hop re-runs every check; credential
 *    headers are dropped on any cross-host hop
 *  - hard response-size and wall-clock limits
 */
import { lookup as nodeLookup } from 'node:dns/promises';
import https from 'node:https';
import http from 'node:http';
import type { IncomingMessage } from 'node:http';
import { isPublicIp } from './ip';

export interface EgressPolicy {
  /**
   * Hosts this request may reach: exact names or `*.suffix` patterns.
   * Omit for generic rails — any public host, but then credential headers
   * must be pinned via `credentialHosts`.
   */
  allowedHosts?: string[];
  /**
   * Hosts entitled to receive Authorization/Cookie headers. Defaults to
   * `allowedHosts`. Generic rails set this to the single user-registered
   * host so a user-supplied credential can never be redirected elsewhere.
   */
  credentialHosts?: string[];
  maxResponseBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

export interface SafeFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  signal?: AbortSignal;
}

export interface SafeResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  url: string;
  text(): string;
  json(): unknown;
}

export class EgressDeniedError extends Error {
  constructor(
    readonly reason: string,
    detail: string,
  ) {
    super(`egress denied (${reason}): ${detail}`);
    this.name = 'EgressDeniedError';
  }
}

type LookupFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

/**
 * TEST-ONLY seams. Production callers must never pass this parameter — it
 * exists so the suite can aim safeFetch at in-process servers and simulate
 * rebinding without weakening the shipped defaults.
 */
export interface UnsafeTestOverrides {
  lookup?: LookupFn;
  isPublicIp?: (addr: string) => boolean;
  allowHttp?: boolean;
  allowAnyPort?: boolean;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 3;
const CREDENTIAL_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];

export function hostMatchesPattern(host: string, pattern: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  const p = pattern.toLowerCase();
  if (p.startsWith('*.')) {
    const suffix = p.slice(2);
    return h === suffix || h.endsWith('.' + suffix);
  }
  return h === p;
}

export function hostAllowed(host: string, patterns: string[] | undefined): boolean {
  if (!patterns) return true;
  return patterns.some((p) => hostMatchesPattern(host, p));
}

const defaultLookup: LookupFn = async (hostname) => {
  const found = await nodeLookup(hostname, { all: true, verbatim: true });
  return found.map((f) => ({ address: f.address, family: f.family }));
};

function lowerHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v;
  return out;
}

export async function safeFetch(
  url: string | URL,
  init: SafeFetchInit = {},
  policy: EgressPolicy = {},
  unsafeTestOverrides?: UnsafeTestOverrides,
): Promise<SafeResponse> {
  if (init.signal?.aborted) throw init.signal.reason as Error;
  const lookup = unsafeTestOverrides?.lookup ?? defaultLookup;
  const ipIsPublic = unsafeTestOverrides?.isPublicIp ?? isPublicIp;
  const maxBytes = policy.maxResponseBytes ?? DEFAULT_MAX_BYTES;
  const deadline = Date.now() + (policy.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxRedirects = policy.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const credentialHosts = policy.credentialHosts ?? policy.allowedHosts;

  let current = new URL(typeof url === 'string' ? url : url.href);
  let method = (init.method ?? 'GET').toUpperCase();
  let body = init.body;
  const headers = lowerHeaders(init.headers ?? {});

  for (let hop = 0; ; hop++) {
    if (current.protocol !== 'https:' && !(unsafeTestOverrides?.allowHttp && current.protocol === 'http:')) {
      throw new EgressDeniedError('protocol', `${current.protocol} is not allowed`);
    }
    if (current.username || current.password) {
      throw new EgressDeniedError('userinfo', 'URLs with embedded credentials are not allowed');
    }
    if (current.port && !unsafeTestOverrides?.allowAnyPort) {
      const defaultPort = current.protocol === 'https:' ? '443' : '80';
      if (current.port !== defaultPort) {
        throw new EgressDeniedError('port', `non-default port ${current.port}`);
      }
    }
    const hostname = current.hostname.replace(/^\[|\]$/g, '');
    if (!hostAllowed(hostname, policy.allowedHosts)) {
      throw new EgressDeniedError('allowlist', `${hostname} is not in the connector's egress allowlist`);
    }

    // credential headers only ever travel to explicitly entitled hosts
    const hasCredential = CREDENTIAL_HEADERS.some((h) => h in headers);
    if (hasCredential && !credentialHosts) {
      throw new EgressDeniedError(
        'credentials',
        'credential headers require an explicit credentialHosts/allowedHosts entitlement',
      );
    }
    if (hasCredential && !hostAllowed(hostname, credentialHosts)) {
      throw new EgressDeniedError('credentials', `credential headers may not be sent to ${hostname}`);
    }

    // resolve + validate every answer, then pin the connection to one of them
    let pinned: { address: string; family: number };
    const asLiteral = hostname.includes(':') || /^\d+(\.\d+){3}$/.test(hostname);
    if (asLiteral) {
      if (!ipIsPublic(hostname)) {
        throw new EgressDeniedError('private-ip', `${hostname} is not a public address`);
      }
      pinned = { address: hostname, family: hostname.includes(':') ? 6 : 4 };
    } else {
      let answers: Array<{ address: string; family: number }>;
      try {
        answers = await lookup(hostname);
      } catch {
        throw new EgressDeniedError('dns', `cannot resolve ${hostname}`);
      }
      if (answers.length === 0) {
        throw new EgressDeniedError('dns', `no addresses for ${hostname}`);
      }
      for (const a of answers) {
        if (!ipIsPublic(a.address)) {
          // one private answer poisons the whole set — split-horizon and
          // rebinding tricks often mix one public answer in
          throw new EgressDeniedError('private-ip', `${hostname} resolves to non-public ${a.address}`);
        }
      }
      pinned = answers[0]!;
    }

    const timeLeft = deadline - Date.now();
    if (timeLeft <= 0) throw new EgressDeniedError('timeout', 'egress deadline exhausted');

    const res = await pinnedRequest(current, pinned, method, headers, body, timeLeft, maxBytes, init.signal);

    const status = res.status;
    const location = res.headers['location'];
    if (status >= 300 && status < 400 && location !== undefined) {
      if (hop >= maxRedirects) throw new EgressDeniedError('redirect', 'too many redirects');
      const next = new URL(location, current);
      if (next.hostname !== current.hostname) {
        for (const h of CREDENTIAL_HEADERS) delete headers[h];
        // 307/308 preserve method+body by spec, but forwarding a body cross-host
        // leaks the request payload to an unintended destination. Strip it.
        if (status === 307 || status === 308) {
          body = undefined;
          delete headers['content-type'];
          delete headers['content-length'];
        }
      }
      if (status === 303 || ((status === 301 || status === 302) && method === 'POST')) {
        method = 'GET';
        body = undefined;
        delete headers['content-type'];
        delete headers['content-length'];
      }
      current = next;
      continue;
    }
    return res;
  }
}

function pinnedRequest(
  target: URL,
  pinned: { address: string; family: number },
  method: string,
  headers: Record<string, string>,
  body: string | Uint8Array | undefined,
  timeoutMs: number,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<SafeResponse> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason as Error);
      return;
    }
    const isHttps = target.protocol === 'https:';
    const port = target.port ? Number(target.port) : isHttps ? 443 : 80;
    const hostname = target.hostname.replace(/^\[|\]$/g, '');

    const options: https.RequestOptions = {
      // connect to the validated address; never re-resolve
      host: pinned.address,
      family: pinned.family,
      port,
      path: target.pathname + target.search,
      method,
      // TLS validates against the real hostname, HTTP routes by Host header
      servername: isHttps ? hostname : undefined,
      headers: { ...headers, host: hostname },
      timeout: timeoutMs,
      signal,
    };

    const mod = isHttps ? https : http;
    const req = mod.request(options, (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy();
          reject(new EgressDeniedError('size', `response exceeded ${maxBytes} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const respHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          respHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : (v ?? '');
        }
        const buf = Buffer.concat(chunks);
        resolve({
          status: res.statusCode ?? 0,
          headers: respHeaders,
          body: buf,
          url: target.href,
          text: () => buf.toString('utf8'),
          json: () => JSON.parse(buf.toString('utf8')) as unknown,
        });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => {
      req.destroy(new EgressDeniedError('timeout', 'socket timeout'));
    });
    req.on('error', (err) => {
      reject(err instanceof EgressDeniedError ? err : new EgressDeniedError('network', String(err)));
    });
    if (body !== undefined) req.write(body);
    req.end();
  });
}
