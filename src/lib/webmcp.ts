export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => unknown;
};

export type ToolCall = {
  at: number;
  tool: string;
  input: string;
  summary: string;
};

export type RegistrationState = {
  api: "document.modelContext" | "navigator.modelContext" | "unavailable";
  toolCount: number;
};

type ModelContextLike = {
  registerTool: (tool: unknown, options?: unknown) => Promise<void> | void;
};

function modelContext(): ModelContextLike | undefined {
  const holders = [document as unknown, navigator as unknown] as Record<string, unknown>[];
  for (const holder of holders) {
    const candidate = holder.modelContext as ModelContextLike | undefined;
    if (candidate && typeof candidate.registerTool === "function") return candidate;
  }
  return undefined;
}

/**
 * Chrome's current implementation hands arguments over as a JSON string and
 * stringifies whatever the tool returns, so every tool speaks JSON text.
 */
function parseInput(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    return raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {};
  }
  return (raw as Record<string, unknown>) ?? {};
}

function runTool(definition: ToolDefinition, input: Record<string, unknown>): unknown {
  try {
    return definition.execute(input);
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : String(cause) };
  }
}

export function registerTools(
  definitions: ToolDefinition[],
  onCall: (call: ToolCall) => void,
): RegistrationState {
  const context = modelContext();
  if (!context) return { api: "unavailable", toolCount: 0 };

  for (const definition of definitions) {
    context.registerTool({
      name: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema,
      execute: async (raw: unknown) => {
        const input = parseInput(raw);
        const text = JSON.stringify(runTool(definition, input));
        onCall({
          at: Date.now(),
          tool: definition.name,
          input: JSON.stringify(input),
          summary: `${text.length} chars`,
        });
        return { content: [{ type: "text", text }] };
      },
    });
  }

  const api = (document as unknown as Record<string, unknown>).modelContext
    ? "document.modelContext"
    : "navigator.modelContext";
  return { api, toolCount: definitions.length };
}
