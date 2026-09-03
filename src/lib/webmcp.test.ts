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
