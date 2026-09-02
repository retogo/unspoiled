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
  error?: string;
};

export type Registration = {
  ready: Promise<RegistrationState>;
  unregister: () => void;
};

type ModelContextLike = {
  registerTool: (tool: unknown, options?: unknown) => Promise<void> | void;
  unregisterTool?: (name: string) => Promise<void> | void;
};

type Holder = { api: RegistrationState["api"]; context: ModelContextLike };

function modelContext(): Holder | undefined {
  const holders: { api: RegistrationState["api"]; holder: Record<string, unknown> }[] = [
    { api: "document.modelContext", holder: document as unknown as Record<string, unknown> },
    { api: "navigator.modelContext", holder: navigator as unknown as Record<string, unknown> },
  ];
  for (const { api, holder } of holders) {
    const candidate = holder.modelContext as ModelContextLike | undefined;
    if (candidate && typeof candidate.registerTool === "function") return { api, context: candidate };
  }
  return undefined;
}

/**
 * Registering and unregistering are queued so they reach the browser in the
 * order they were asked for. React mounts the page twice in development, and
 * without a queue the first mount's cleanup could arrive after the second
 * mount's registration and take the live tools away.
 */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => {});
  return next;
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

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function runTool(definition: ToolDefinition, input: Record<string, unknown>): Promise<unknown> {
  try {
    return await definition.execute(input);
  } catch (cause) {
    return { error: message(cause) };
  }
}

export function registerTools(definitions: ToolDefinition[], onCall: (call: ToolCall) => void): Registration {
  const holder = modelContext();
  if (!holder) {
    return { ready: Promise.resolve({ api: "unavailable", toolCount: 0 }), unregister: () => {} };
  }
  const { api, context } = holder;

  const outcomes = definitions.map((definition) =>
    enqueue(async () =>
      context.registerTool({
        name: definition.name,
        description: definition.description,
        inputSchema: definition.inputSchema,
        execute: async (raw: unknown) => {
          const input = parseInput(raw);
          const text = JSON.stringify(await runTool(definition, input));
          onCall({
            at: Date.now(),
            tool: definition.name,
            input: JSON.stringify(input),
            summary: `${text.length} chars`,
          });
          return { content: [{ type: "text", text }] };
        },
      }),
    ),
  );

  const ready = Promise.allSettled(outcomes).then((settled) => {
    const errors = settled.flatMap((outcome) => (outcome.status === "rejected" ? [message(outcome.reason)] : []));
    return { api, toolCount: settled.length - errors.length, error: errors[0] };
  });

  return {
    ready,
    unregister: () => {
      for (const definition of definitions) {
        void enqueue(async () => context.unregisterTool?.(definition.name));
      }
    },
  };
}
