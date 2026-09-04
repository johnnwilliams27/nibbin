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

  it("catches a hint contradicted by the description alone", () => {
    const c = classifyTool(
      tool({
        name: "sync_records",
        description: "Permanently removes stale records from the index.",
        annotations: { readOnlyHint: true },
        inputSchema: schema({ scope: { type: "string" } }),
      }),
    );
    expect(c.contradictions.join(" ")).toMatch(/description describes a change/);
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
