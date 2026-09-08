/**
 * The OTHER MCP transport, which we were not speaking.
 *
 * MCP has two HTTP transports. `streamable-http` takes a POST at one endpoint
 * and answers in the response. The legacy `sse` transport does not:
 *
 *   1. The client GETs the endpoint with `Accept: text/event-stream`.
 *   2. The server holds that stream open and sends `event: endpoint`, whose
 *      data is a SECOND url — where messages are to be POSTed.
 *   3. The client POSTs JSON-RPC there. The POST returns 202 and no useful
 *      body; the ANSWER arrives back on the stream opened in step 1.
 *
 * `probeMcpServer` only ever POSTed at the advertised endpoint, so every one of
 * these servers answered 404, 405 or 400 and we filed it as broken.
 *
 * WHAT THAT COST, measured over the full registry sweep:
 *
 *     transport          probed   tools listed        failed
 *     streamable-http    14,295     8,380 (59%)    2,236 (16%)
 *     sse                   748       144 (19%)      550 (74%)
 *
 * A 74% failure rate against 16%, and it is not a property of those servers.
 * Two of the three I checked by hand — recorded as "HTTP 404", which reads as
 * gone — answer a GET with 200 and a well-formed endpoint event. We wrote off
 * working servers because we knocked on the wrong door and reported the silence
 * as theirs.
 *
 * That is this project's oldest error wearing its newest disguise: "I could not
 * obtain the data" recorded as "the data is not there".
 *
 * SECURITY. The stream and the message POST both go through the same guard as
 * everything else — `vetUrl`, then `vetResolved`, then `pinnedFetch` on the
 * vetted addresses. The endpoint event names a url chosen by the SUBJECT, so it
 * is re-vetted before it is dialled rather than trusted for being a redirect
 * from a host we already accepted.
 */
import { pinnedFetch, vetResolved, vetUrl } from "../net.js";

export type SseCall = { id: number; method: string; params?: unknown };

export type SseProbeResult = {
  ok: boolean;
  /** Where the server told us to POST. Null when it never said. */
  messageUrl: string | null;
  /** JSON-RPC replies keyed by request id, as they arrived on the stream. */
  replies: Map<number, unknown>;
  status: number | null;
  reason: string | null;
  elapsedMs: number;
};

/** Split an SSE buffer into complete frames, returning the remainder. */
export function parseFrames(buffer: string): { frames: Array<{ event: string; data: string }>; rest: string } {
  const frames: Array<{ event: string; data: string }> = [];
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? "";
  for (const block of parts) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      // Per the SSE spec a leading single space after the colon is stripped,
      // and multiple data lines in one frame are joined with newlines. Getting
      // this wrong truncates JSON bodies that happen to wrap.
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length > 0 || event !== "message") frames.push({ event, data: data.join("\n") });
  }
  return { frames, rest };
}

async function dial(url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) {
  const vetted = vetUrl(url);
  if (!vetted.allowed) throw new Error(`blocked: ${vetted.reason}`);
  const resolved = await vetResolved(vetted.url.hostname);
  if (!resolved.allowed) throw new Error(`blocked: ${resolved.reason}`);
  return pinnedFetch(vetted.url.toString(), { ...init, addresses: resolved.addresses });
}

/**
 * Open the stream, learn where to post, run the calls, collect the answers.
 *
 * One deadline covers the whole exchange. The stream is aborted as soon as
 * every call has an answer — an SSE connection stays open forever by design, so
 * a reader that waits for the body to end waits for ever. That is exactly what
 * happened the first time I pointed `guardedFetch` at one of these: it hung
 * until the tool timeout, with the endpoint event already sitting in the buffer.
 */
export async function probeViaSse(
  endpoint: string,
  calls: SseCall[],
  opts: { timeoutMs?: number; headers?: Record<string, string>; maxBytes?: number } = {},
): Promise<SseProbeResult> {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const maxBytes = opts.maxBytes ?? 512 * 1024;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const replies = new Map<number, unknown>();
  let messageUrl: string | null = null;
  let status: number | null = null;

  try {
    const res = await dial(endpoint, {
      method: "GET",
      headers: { accept: "text/event-stream", "cache-control": "no-cache", ...(opts.headers ?? {}) },
      signal: controller.signal,
    });
    status = res.status;
    const ctype = res.headers.get("content-type") ?? "";
    if (!res.ok || !ctype.includes("text/event-stream")) {
      return { ok: false, messageUrl: null, replies, status, reason: `GET did not open a stream (${status}, ${ctype || "no content-type"})`, elapsedMs: Date.now() - started };
    }
    if (res.body === null) {
      return { ok: false, messageUrl: null, replies, status, reason: "stream had no body", elapsedMs: Date.now() - started };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let bytes = 0;
    let posted = false;

    // RACE EVERY READ AGAINST THE DEADLINE.
    //
    // Aborting the controller does not reliably reject an in-flight
    // reader.read() on the pinned transport: the abort tears down the request,
    // but the read simply never settles, so the loop parks forever and the only
    // thing that stops it is whatever timeout is wrapping the whole process.
    // Measured: a 15s per-server deadline still hung past 120s. The deadline has
    // to be enforced HERE, on each read, rather than delegated to the signal.
    const deadlineAt = started + timeoutMs;
    const readOrTimeout = async (): Promise<{ done: boolean; value?: Uint8Array }> => {
      const left = deadlineAt - Date.now();
      if (left <= 0) return { done: true };
      return Promise.race([
        reader.read() as Promise<{ done: boolean; value?: Uint8Array }>,
        new Promise<{ done: boolean }>((r) => setTimeout(() => r({ done: true }), left)),
      ]);
    };

    for (;;) {
      const { done, value } = await readOrTimeout();
      if (done) break;
      bytes += value?.byteLength ?? 0;
      if (bytes > maxBytes) {
        void reader.cancel();
        return { ok: false, messageUrl, replies, status, reason: "stream exceeded byte cap", elapsedMs: Date.now() - started };
      }
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = parseFrames(buffer);
      buffer = rest;

      for (const f of frames) {
        if (f.event === "endpoint" && messageUrl === null) {
          // Subject-chosen url. Resolve against the stream's own origin, then
          // let dial() re-vet it — a path here can be absolute, and an absolute
          // one can point anywhere.
          messageUrl = new URL(f.data, endpoint).toString();
        } else if (f.data.startsWith("{")) {
          try {
            const msg = JSON.parse(f.data) as { id?: number };
            if (typeof msg.id === "number") replies.set(msg.id, msg);
          } catch {
            /* a frame that is not a JSON-RPC message is not an error */
          }
        }
      }

      // Post everything once, as soon as we know where.
      if (messageUrl !== null && !posted) {
        posted = true;
        for (const c of calls) {
          await dial(messageUrl, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(opts.headers ?? {}) },
            body: JSON.stringify({ jsonrpc: "2.0", id: c.id, method: c.method, ...(c.params === undefined ? {} : { params: c.params }) }),
            signal: controller.signal,
          }).catch(() => undefined);
          // notifications/* never get a reply, so they must not be waited on.
          if (c.method.startsWith("notifications/")) replies.set(c.id, null);
        }
      }

      const wanted = calls.filter((c) => !c.method.startsWith("notifications/")).map((c) => c.id);
      if (posted && wanted.every((id) => replies.has(id))) {
        void reader.cancel();
        break;
      }
    }

    return {
      ok: messageUrl !== null,
      messageUrl,
      replies,
      status,
      reason: messageUrl === null ? "stream opened but no endpoint event arrived" : null,
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
    const aborted = controller.signal.aborted;
    return {
      ok: false,
      messageUrl,
      replies,
      status,
      reason: aborted ? "the exchange exceeded its deadline" : String(err).slice(0, 160),
      elapsedMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
