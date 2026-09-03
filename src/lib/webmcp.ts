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
  ok: boolean;
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

type LiveTool = { definition: ToolDefinition; onCall: (call: ToolCall) => void };

/**
 * Chrome keeps a tool for the life of the page: there is no `unregisterTool`,
 * and registering a name twice is refused. A name is therefore handed to the
 * browser once, and the handler it gets looks the definition up here on every
 * call so it always runs the one the page is offering now.
 */
const live = new Map<string, LiveTool>();

const exposedNames = new WeakMap<ModelContextLike, Set<string>>();

function exposedBy(context: ModelContextLike): Set<string> {
  const known = exposedNames.get(context);
  if (known) return known;
  const fresh = new Set<string>();
  exposedNames.set(context, fresh);
  return fresh;
}

/**
 * Work reaches the browser in the order it was asked for. React mounts the page
 * twice in development, so the first mount's cleanup must not overtake the
 * second mount's registration.
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

function isDuplicateName(cause: unknown): boolean {
  return (cause as { name?: unknown } | null)?.name === "InvalidStateError";
}

type Outcome = { ok: boolean; value: unknown };

async function runTool(definition: ToolDefinition, input: Record<string, unknown>): Promise<Outcome> {
  try {
    return { ok: true, value: await definition.execute(input) };
  } catch (cause) {
    return { ok: false, value: { error: message(cause) } };
  }
}

function reply(value: unknown, ok: boolean) {
  const content = [{ type: "text", text: JSON.stringify(value) }];
  return ok ? { content } : { content, isError: true };
}

/** Rule values can be spoilers themselves, so they never enter the reader-visible activity log. */
function loggedInput(name: string, input: Record<string, unknown>): string {
  if (name !== "add_rules") return JSON.stringify(input);
  const count = Array.isArray(input.words) ? input.words.length : 0;
  return JSON.stringify({ words: `${count} redacted` });
}

function dispatch(name: string) {
  return async (raw: unknown) => {
    const entry = live.get(name);
    if (!entry) return reply({ error: "This tool is no longer offered by the page." }, false);
    const input = parseInput(raw);
    const { ok, value } = await runTool(entry.definition, input);
    const text = JSON.stringify(value);
    entry.onCall({ at: Date.now(), tool: name, input: loggedInput(name, input), ok, summary: `${text.length} chars` });
    return reply(value, ok);
  };
}

export function registerTools(definitions: ToolDefinition[], onCall: (call: ToolCall) => void): Registration {
  for (const definition of definitions) live.set(definition.name, { definition, onCall });
  const forget = () => {
    for (const definition of definitions) live.delete(definition.name);
  };

  const holder = modelContext();
  if (!holder) {
    return { ready: Promise.resolve({ api: "unavailable", toolCount: 0 }), unregister: forget };
  }
  const { api, context } = holder;
  const exposed = exposedBy(context);

  const outcomes = definitions.map((definition) =>
    enqueue(async () => {
      if (exposed.has(definition.name)) return;
      try {
        await context.registerTool({
          name: definition.name,
          description: definition.description,
          inputSchema: definition.inputSchema,
          execute: dispatch(definition.name),
        });
      } catch (cause) {
        if (!isDuplicateName(cause)) throw cause;
      }
      exposed.add(definition.name);
    }),
  );

  const ready = Promise.allSettled(outcomes).then((settled) => {
    const errors = settled.flatMap((outcome) => (outcome.status === "rejected" ? [message(outcome.reason)] : []));
    const toolCount = definitions.filter((definition) => exposed.has(definition.name)).length;
    return { api, toolCount, error: errors[0] };
  });

  const takeBack = context.unregisterTool;
  return {
    ready,
    unregister: () => {
      forget();
      if (!takeBack) return;
      for (const definition of definitions) {
        void enqueue(async () => {
          await takeBack.call(context, definition.name);
          exposed.delete(definition.name);
        });
      }
    },
  };
}
