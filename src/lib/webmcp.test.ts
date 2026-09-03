import { afterEach, describe, expect, it } from "vitest";
import { registerTools, type ToolCall, type ToolDefinition } from "./webmcp";

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };
type RegisteredTool = { name: string; execute: (raw: unknown) => Promise<ToolResult> };

function tool(name: string, execute: ToolDefinition["execute"]): ToolDefinition {
  return {
    name,
    description: `${name} for the test`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute,
  };
}

async function installAgent(definitions: ToolDefinition[]) {
  const registered: RegisteredTool[] = [];
  const calls: ToolCall[] = [];
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    writable: true,
    value: {
      registerTool: (candidate: RegisteredTool) => {
        registered.push(candidate);
        return Promise.resolve();
      },
      unregisterTool: () => Promise.resolve(),
    },
  });
  await registerTools(definitions, (call) => calls.push(call)).ready;
  return { registered, calls };
}

afterEach(() => {
  Reflect.deleteProperty(document, "modelContext");
});

describe("a tool whose handler throws", () => {
  it("comes back marked as an error, with the reason in the body", async () => {
    const { registered } = await installAgent([
      tool("list_sections", () => {
        throw new Error("No article is open. Call open_article first.");
      }),
    ]);

    const result = await registered[0].execute("{}");

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({ error: "No article is open. Call open_article first." });
  });
});

describe("a tool whose handler returns", () => {
  it("comes back without the error flag, so the agent reads it as a success", async () => {
    const { registered } = await installAgent([tool("get_masking_report", () => ({ hidden: 3 }))]);

    const result = await registered[0].execute("{}");

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ hidden: 3 });
  });
});

describe("the record of a call", () => {
  it("redacts add_rules values because the rules may themselves be spoilers", async () => {
    const { registered, calls } = await installAgent([tool("add_rules", () => ({ added: 2 }))]);

    await registered[0].execute(JSON.stringify({ words: ["the killer", "secret identity"] }));

    expect(calls[0].input).toBe(JSON.stringify({ words: "2 redacted" }));
    expect(calls[0].input).not.toMatch(/killer|identity/);
  });

  it("marks a call that failed", async () => {
    const { registered, calls } = await installAgent([
      tool("get_section", () => {
        throw new Error("Unknown section_id: s9");
      }),
    ]);

    await registered[0].execute(JSON.stringify({ section_id: "s9" }));

    expect(calls).toHaveLength(1);
    expect(calls[0].ok).toBe(false);
    expect(calls[0].tool).toBe("get_section");
  });

  it("marks a call that succeeded", async () => {
    const { registered, calls } = await installAgent([tool("list_sections", () => ({ sections: [] }))]);

    await registered[0].execute("{}");

    expect(calls[0].ok).toBe(true);
  });
});

/**
 * Chrome exposes no `unregisterTool`, and a second `registerTool` for a name it
 * already holds rejects with `InvalidStateError: Duplicate tool name`.
 */
function installChromeAgent(alreadyInBrowser: string[] = []) {
  const names = new Set(alreadyInBrowser);
  const registered: RegisteredTool[] = [];
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    writable: true,
    value: {
      registerTool: (candidate: RegisteredTool) => {
        if (names.has(candidate.name)) {
          return Promise.reject(new DOMException("Duplicate tool name", "InvalidStateError"));
        }
        names.add(candidate.name);
        registered.push(candidate);
        return Promise.resolve();
      },
      getTools: () => Promise.resolve([...names].map((name) => ({ name }))),
    },
  });
  return { registered };
}

describe("registering the same tools again", () => {
  it("leaves every tool exposed and reports no error", async () => {
    const { registered } = installChromeAgent();
    const definitions = () => [tool("list_sections", () => ({ sections: [] })), tool("get_masking_report", () => ({}))];

    await registerTools(definitions(), () => {}).ready;
    const second = await registerTools(definitions(), () => {}).ready;

    expect(second.error).toBeUndefined();
    expect(second.toolCount).toBe(2);
    expect(registered).toHaveLength(2);
  });

  it("makes the browser call the newest definition", async () => {
    const { registered } = installChromeAgent();
    const calls: ToolCall[] = [];

    await registerTools([tool("get_masking_report", () => ({ hidden: 1 }))], () => {}).ready;
    await registerTools([tool("get_masking_report", () => ({ hidden: 2 }))], (call) => calls.push(call)).ready;

    const result = await registered[0].execute("{}");

    expect(JSON.parse(result.content[0].text)).toEqual({ hidden: 2 });
    expect(calls).toHaveLength(1);
  });

  it("counts a name the browser already holds as exposed", async () => {
    const { registered } = installChromeAgent(["read_article_content"]);

    const state = await registerTools([tool("read_article_content", () => ({}))], () => {}).ready;

    expect(state.error).toBeUndefined();
    expect(state.toolCount).toBe(1);
    expect(registered).toHaveLength(0);
  });

  it("still reports a refusal that is not a duplicate name", async () => {
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      writable: true,
      value: { registerTool: () => Promise.reject(new Error("Tool limit reached")) },
    });

    const state = await registerTools([tool("list_sections", () => ({}))], () => {}).ready;

    expect(state.error).toBe("Tool limit reached");
    expect(state.toolCount).toBe(0);
  });
});

describe("a tool the page has taken back", () => {
  it("tells the agent it is no longer offered instead of running the old handler", async () => {
    const { registered } = installChromeAgent();
    const registration = registerTools([tool("apply_mask", () => ({ show: 4 }))], () => {});
    await registration.ready;

    registration.unregister();
    const result = await registered[0].execute("{}");

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({ error: "This tool is no longer offered by the page." });
  });
});
