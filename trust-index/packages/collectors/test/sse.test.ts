/**
 * SSE frame parsing.
 *
 * These matter because the transport was invisible for so long: 748 servers
 * declared `sse` and 74% of them were recorded as broken, against 16% for
 * streamable-http. Servers answering 200 with a well-formed endpoint event were
 * filed as "HTTP 404". The parser is now the thing standing between us and
 * repeating that.
 */
import { describe, expect, it } from "vitest";
import { parseFrames } from "../src/mcp/sse.js";

describe("parseFrames", () => {
  it("reads the endpoint event that names where to POST", () => {
    const { frames } = parseFrames("event: endpoint\ndata: /messages?sessionId=abc\n\n");
    expect(frames).toEqual([{ event: "endpoint", data: "/messages?sessionId=abc" }]);
  });

  it("keeps a partial frame back rather than parsing half a message", () => {
    // A chunk boundary mid-frame must not produce a truncated JSON body.
    const { frames, rest } = parseFrames('event: message\ndata: {"id":1,"resu');
    expect(frames).toEqual([]);
    expect(rest).toBe('event: message\ndata: {"id":1,"resu');
  });

  it("joins multi-line data with newlines, per the SSE spec", () => {
    // Getting this wrong truncates any JSON body long enough to wrap.
    const { frames } = parseFrames('data: {"a":1,\ndata: "b":2}\n\n');
    expect(frames[0]?.data).toBe('{"a":1,\n"b":2}');
  });

  it("strips exactly one leading space after the colon, not all whitespace", () => {
    const { frames } = parseFrames("data:  two spaces\n\n");
    expect(frames[0]?.data).toBe(" two spaces");
  });

  it("handles CRLF, which real servers send", () => {
    const { frames } = parseFrames("event: endpoint\r\ndata: /m\r\n\r\n");
    expect(frames).toEqual([{ event: "endpoint", data: "/m" }]);
  });

  it("parses several frames arriving in one chunk", () => {
    const { frames } = parseFrames('event: endpoint\ndata: /m\n\ndata: {"id":1}\n\n');
    expect(frames).toHaveLength(2);
    expect(frames[1]?.data).toBe('{"id":1}');
  });

  it("defaults the event name to message when only data is sent", () => {
    const { frames } = parseFrames('data: {"id":7}\n\n');
    expect(frames[0]?.event).toBe("message");
  });
});
