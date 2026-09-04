/**
 * Tool shape classification.
 *
 * The distinction that matters most here is not destructive versus read-only.
 * It is whether we can supply the target: a tool that acts on something we
 * name can be pointed at a sandbox we own and then diffed, and a tool bound to
 * the operator's own resource cannot.
 */
import { describe, expect, it } from "vitest";
import { CAPABILITIES } from "../src/capability.js";
import { classifyTool, classifyTools, requiredCapabilities, testability } from "../src/mcp/shape.js";
import { callTool, synthesizeInput, NotCallableError } from "../src/mcp/invoke.js";
import type { ToolDeclaration } from "../src/mcp/transcript.js";

function tool(over: Partial<ToolDeclaration> & { name: string }): ToolDeclaration {
  return {
    description: "A tool that does a thing to some data somewhere.",
    inputSchema: { type: "object", properties: {}, required: [] },
    outputSchema: null,
    annotations: null,
    ...over,
  };
}

const schema = (props: Record<string, unknown>, required: string[] = Object.keys(props)) => ({
  type: "object",
  properties: Object.fromEntries(Object.keys(props).map((k) => [k, props[k]])),
  required,
});

describe("read-only classification", () => {
  it("authorizes a call only on agreement, never on one unverified hint", () => {
    // MCP's own spec says a client must not trust readOnlyHint for security.
    // We do not: the hint authorizes a call only when the name, description
    // and schema all agree with it.
    const agreed = classifyTool(
      tool({
        name: "search_docs",
        description: "Search the corpus and return matching passages.",
        annotations: { readOnlyHint: true },
        inputSchema: schema({ query: { type: "string" } }),
      }),
    );
    expect(agreed.binding.kind).toBe("read_only");
    expect(agreed.contradictions).toEqual([]);
  });

  it("refuses to call a tool whose hint and name disagree, and reports the disagreement", () => {
    const lying = classifyTool(
      tool({
        name: "delete_document",
        description: "Removes a document.",
        annotations: { readOnlyHint: true },
        inputSchema: schema({ id: { type: "string" } }),
      }),
    );
    expect(lying.binding.kind).not.toBe("read_only");
    expect(lying.contradictions.join(" ")).toMatch(/readOnlyHint but is named like a mutation/);
  });

  it("does not accuse an operator on the strength of a verb stem in prose", () => {
    // The rule that read change-verbs anywhere in a description produced 125
    // of 190 contradictions in a 600-server sample and was overwhelmingly
    // wrong: it flagged "written for practitioners", "Written by a named
    // human", and a tool that LISTS platforms "where a consultant can create a
    // profile". A published contradiction accuses a named operator of lying
    // about their tool, so the bar is higher than a word list can reach.
    for (const description of [
      "Search the concept encyclopaedia, written for practitioners.",
      "Fetch one entry by slug. Written by a named human editor.",
      "The subset of the directory where a consultant can create a profile.",
    ]) {
      const c = classifyTool(
        tool({
          name: "search_concepts",
          description,
          annotations: { readOnlyHint: true },
          inputSchema: schema({ query: { type: "string" } }),
        }),
      );
      expect(c.contradictions, description).toEqual([]);
      expect(c.binding.kind).toBe("read_only");
    }
  });

  it("still declines to CALL a tool whose description hints at change", () => {
    // The same wide pattern guards invocation, and only invocation. A false
    // positive there costs coverage; a false positive in a published finding
    // costs someone their reputation. Different bars, deliberately.
    const c = classifyTool(
      tool({
        name: "sync_records",
        description: "Removes stale records from the index.",
        annotations: null,
        inputSchema: schema({ scope: { type: "string" } }),
      }),
    );
    expect(c.binding.kind).not.toBe("read_only");
  });

  it("catches a tool declaring itself both read-only and destructive", () => {
    const c = classifyTool(
      tool({ name: "process", annotations: { readOnlyHint: true, destructiveHint: true } }),
    );
    expect(c.contradictions.join(" ")).toMatch(/both readOnlyHint and destructiveHint/);
  });

  it("flags a mutating tool that can be called with no arguments", () => {
    // The empty call is a valid call, which means "delete everything" is one
    // request away. A blast-radius finding from the schema alone.
    const c = classifyTool(
      tool({
        name: "delete_documents",
        annotations: { destructiveHint: true },
        inputSchema: schema({ filter: { type: "object" } }, []),
      }),
    );
    expect(c.contradictions.join(" ")).toMatch(/no required parameters/);
  });
});

describe("target substitutability", () => {
  it("recognises a target we can supply, and which sandbox supplies it", () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ["send_email", { to: { type: "string" }, body: { type: "string" } }, CAPABILITIES.mailbox],
      ["create_issue", { repo: { type: "string" }, title: { type: "string" } }, CAPABILITIES.repo_sandbox],
      ["transfer_funds", { to_address: { type: "string" }, amount: { type: "number" } }, CAPABILITIES.testnet_wallet],
      ["run_script", { code: { type: "string" } }, CAPABILITIES.exec_sandbox],
      ["post_message", { channel: { type: "string" }, text: { type: "string" } }, CAPABILITIES.chat_sandbox],
    ];
    for (const [name, props, capability] of cases) {
      const c = classifyTool(tool({ name, inputSchema: schema(props) }));
      expect(c.binding.kind, name).toBe("substitutable");
      if (c.binding.kind === "substitutable") expect(c.binding.capability, name).toBe(capability);
    }
  });

  it("does not mistake a body field for a target", () => {
    // `recipient_email` names a target; `email_body` does not. A substring
    // search would treat both as substitutable and point a live send at
    // whatever the operator's default recipient is.
    const c = classifyTool(
      tool({ name: "send_notification", inputSchema: schema({ email_body: { type: "string" } }) }),
    );
    expect(c.binding.kind).toBe("operator_bound");
  });

  it("marks a tool bound to the operator's own resource", () => {
    const byId = classifyTool(
      tool({ name: "delete_document", inputSchema: schema({ id: { type: "string" } }) }),
    );
    expect(byId.binding.kind).toBe("operator_bound");
    if (byId.binding.kind === "operator_bound") expect(byId.binding.reason).toMatch(/no parameter names a target/);

    const noArgs = classifyTool(tool({ name: "clear_cache", inputSchema: schema({}) }));
    expect(noArgs.binding.kind).toBe("operator_bound");
    if (noArgs.binding.kind === "operator_bound") expect(noArgs.binding.reason).toMatch(/no parameters/);
  });
});

describe("shape, for battery selection", () => {
  it("reads the shape that decides which tests apply", () => {
    const cases: Array<[string, string, string]> = [
      ["get_weather", "Current weather for a city.", "public_data"],
      ["convert_currency", "Convert between currencies.", "public_data"],
      ["search_docs", "Search the corpus.", "retrieval"],
      ["encode_base64", "Encode a string.", "transform"],
      ["summarize_text", "Summarize a document.", "generation"],
      ["send_email", "Send a message.", "communication"],
      ["execute_sql", "Run a query.", "code_execution"],
      ["charge_card", "Take a payment.", "financial"],
      ["frobnicate", "Does a thing.", "unknown"],
    ];
    for (const [name, description, shape] of cases) {
      expect(classifyTool(tool({ name, description })).shape, name).toBe(shape);
    }
  });
});

describe("testability", () => {
  const tools = [
    tool({ name: "search_docs", description: "Search the corpus.", annotations: { readOnlyHint: true }, inputSchema: schema({ query: { type: "string" } }) }),
    tool({ name: "send_email", inputSchema: schema({ to: { type: "string" } }) }),
    tool({ name: "create_issue", inputSchema: schema({ repo: { type: "string" } }) }),
    tool({ name: "clear_cache", inputSchema: schema({}) }),
  ];

  it("says what we could test today and what provisioning would unlock", () => {
    // The census reads exactly this: how much of the population is workable
    // with what we hold, and which account would buy us the most coverage.
    const withNothing = testability(classifyTools(tools), new Set());
    expect(withNothing.testable).toBe(1);
    expect(withNothing.blocked).toBe(2);
    expect(withNothing.operatorBound).toBe(1);
    expect(withNothing.missing).toEqual([CAPABILITIES.mailbox, CAPABILITIES.repo_sandbox]);

    const withMailbox = testability(classifyTools(tools), new Set([CAPABILITIES.mailbox]));
    expect(withMailbox.testable).toBe(2);
    expect(withMailbox.missing).toEqual([CAPABILITIES.repo_sandbox]);
  });

  it("counts an operator-bound tool as neither testable nor blocked on us", () => {
    // It is not a gap in our harness. No credential we could buy would unlock
    // it, so it must not appear in the provisioning queue.
    const t = testability(classifyTools([tools[3]!]), new Set(Object.values(CAPABILITIES)));
    expect(t.operatorBound).toBe(1);
    expect(t.blocked).toBe(0);
    expect(t.missing).toEqual([]);
  });

  it("lists the capabilities a server would need before it can be exercised", () => {
    expect(requiredCapabilities(classifyTools(tools))).toEqual([CAPABILITIES.mailbox, CAPABILITIES.repo_sandbox]);
  });
});

describe("invocation safety", () => {
  it("refuses to call anything not classified read-only, at the call site", async () => {
    // The guard is re-checked inside callTool rather than inherited from
    // whoever classified the tool. A safety rule enforced only at the point of
    // decision and not at the point of action is one refactor from being
    // enforced nowhere.
    const dangerous = tool({ name: "delete_everything", inputSchema: schema({ id: { type: "string" } }) });
    await expect(
      callTool("https://example.com/mcp", dangerous, classifyTool(dangerous), { parseBody: () => ({ result: {} }) }),
    ).rejects.toThrow(NotCallableError);
  });

  it("refuses a hand-built read-only classification that carries a contradiction", async () => {
    // classifyTool never produces this, since read_only requires zero
    // contradictions. The guard exists for a caller that constructs or caches
    // a classification itself, which is precisely the path where a safety rule
    // checked only at the point of decision would be bypassed.
    const t = tool({ name: "list_things", inputSchema: schema({ q: { type: "string" } }) });
    await expect(
      callTool("https://example.com/mcp", t, {
        tool: "list_things",
        shape: "retrieval",
        binding: { kind: "read_only", basis: "declared" },
        contradictions: ["declares readOnlyHint but is named like a mutation"],
        hints: { readOnly: true, destructive: null, idempotent: null },
      }, { parseBody: () => ({ result: {} }) }),
    ).rejects.toThrow(/contradiction/);
  });

  it("refuses a tool declaring itself both read-only and destructive", async () => {
    const conflicted = tool({
      name: "list_things",
      annotations: { readOnlyHint: true, destructiveHint: true },
      inputSchema: schema({ q: { type: "string" } }),
    });
    await expect(
      callTool("https://example.com/mcp", conflicted, classifyTool(conflicted), { parseBody: () => ({ result: {} }) }),
    ).rejects.toThrow(NotCallableError);
  });

  it("never sends anything shaped like a credential", () => {
    const { args, skipped } = synthesizeInput(
      schema({ query: { type: "string" }, api_key: { type: "string" }, token: { type: "string" } }),
    );
    expect(args).toEqual({ query: "weather" });
    expect(skipped.map((s) => s.parameter).sort()).toEqual(["api_key", "token"]);
  });

  it("sends the smallest valid call, required fields only", () => {
    // Optional parameters are where the sharp edges live, and the minimal call
    // is the one whose behaviour the declaration most clearly predicts.
    const { args } = synthesizeInput(
      schema({ query: { type: "string" }, dangerous_flag: { type: "boolean" } }, ["query"]),
    );
    expect(args).toEqual({ query: "weather" });
  });

  it("prefers a declared enum or default over any guess of ours", () => {
    const { args } = synthesizeInput(
      schema({ mode: { type: "string", enum: ["safe", "wild"] }, fmt: { type: "string", default: "yaml" } }),
    );
    expect(args).toEqual({ mode: "safe", fmt: "yaml" });
  });

  it("respects the declared type over a name hint", () => {
    const { args } = synthesizeInput(schema({ limit: { type: "string" }, query: { type: "integer" } }));
    expect(args).toEqual({ limit: "1", query: 1 });
  });

  it("separates a tool reporting its own failure from a transport failure", async () => {
    // A tool that says "I failed" inside a successful response is behaving
    // correctly at the protocol level and badly at the task level. Conflating
    // the two would make a well-behaved error look like a broken server.
    const t = tool({ name: "search", annotations: { readOnlyHint: true }, inputSchema: schema({ q: { type: "string" } }) });
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 9, result: { content: [{ type: "text", text: "no results" }], isError: true } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const r = await callTool("https://example.com/mcp", t, classifyTool(t), { parseBody: (b) => JSON.parse(b), fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.isError).toBe(true);
    expect(r.textSample).toBe("no results");
  });

  it("checks a response against the tool's own declared output schema", async () => {
    const t = tool({
      name: "search",
      annotations: { readOnlyHint: true },
      inputSchema: schema({ q: { type: "string" } }),
      outputSchema: { type: "object", properties: { hits: { type: "array" } }, required: ["hits"] },
    });
    const reply = (structured: unknown) =>
      (async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 9, result: { content: [], structuredContent: structured } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as unknown as typeof fetch;

    const honoured = await callTool("https://example.com/mcp", t, classifyTool(t), {
      parseBody: (b) => JSON.parse(b), fetchImpl: reply({ hits: [] }),
    });
    expect(honoured.matchesOutputSchema).toBe(true);

    const violated = await callTool("https://example.com/mcp", t, classifyTool(t), {
      parseBody: (b) => JSON.parse(b), fetchImpl: reply({ somethingElse: 1 }),
    });
    expect(violated.matchesOutputSchema).toBe(false);
  });

  it("records response size, because it comes out of the caller's context window", async () => {
    const t = tool({ name: "search", annotations: { readOnlyHint: true }, inputSchema: schema({ q: { type: "string" } }) });
    const big = "x".repeat(5000);
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 9, result: { content: [{ type: "text", text: big }] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const r = await callTool("https://example.com/mcp", t, classifyTool(t), { parseBody: (b) => JSON.parse(b), fetchImpl });
    expect(r.responseBytes).toBeGreaterThan(5000);
    expect(r.textSample!.length).toBe(300);
  });
});

describe("side-effecting shapes are never callable", () => {
  it("reads the leading verb, so a noun cannot drag a read into a send", () => {
    // A first live run called get_broadcast_details and check_email_security,
    // both of which are ordinary reads that landed in the communication bucket
    // because "broadcast" and "email" appear in their names. Harmless in the
    // event, wrong in the classification.
    expect(classifyTool(tool({ name: "get_broadcast_details", description: "Fetch details of a broadcast." })).shape).toBe("retrieval");
    expect(classifyTool(tool({ name: "check_email_security", description: "Check a domain's email security records." })).shape).toBe("retrieval");
    expect(classifyTool(tool({ name: "list_messages", description: "List messages." })).shape).toBe("retrieval");
    // And the verb still wins when it genuinely is a send.
    expect(classifyTool(tool({ name: "send_broadcast", description: "Send a broadcast." })).shape).toBe("communication");
    expect(classifyTool(tool({ name: "post_message", description: "Post a message." })).shape).toBe("communication");
  });

  it("refuses a side-effecting tool that declares itself read-only", () => {
    // readOnlyHint is the operator's claim about one tool; the shape is what
    // the tool is for. A tool that sends does not become safe by asserting it
    // is a read.
    for (const name of ["notify_subscribers", "execute_query", "charge_customer", "delete_record"]) {
      const c = classifyTool(
        tool({ name, description: "Does the thing.", annotations: { readOnlyHint: true }, inputSchema: schema({ x: { type: "string" } }) }),
      );
      expect(c.binding.kind, name).not.toBe("read_only");
      expect(c.contradictions.join(" "), name).toMatch(/declares readOnlyHint but is a/);
    }
  });

  it("will not infer read-only for a side-effecting shape either", () => {
    const c = classifyTool(
      tool({ name: "broadcast_alert", description: "Alerts everyone.", annotations: null, inputSchema: schema({ x: { type: "string" } }) }),
    );
    expect(c.binding.kind).not.toBe("read_only");
  });
});
