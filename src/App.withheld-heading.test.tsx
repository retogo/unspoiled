import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const HTML = `<div class="mw-parser-output">
  <p>The film was released in 1999 and became a sleeper hit around the world.</p>
  <h2>Ending: Kira loses</h2>
  <p>The detective writes his own name in the notebook and waits for the forty seconds to pass.</p>
</div>`;

vi.mock("./lib/wikipedia", () => ({
  fetchArticle: async () => ({
    lang: "en",
    title: "Test",
    displayTitle: "Test article",
    sourceUrl: "https://en.wikipedia.org/wiki/Test",
    sections: [],
    html: HTML,
  }),
  searchArticles: async () => [],
}));

type RegisteredTool = { name: string; execute: (raw: unknown) => Promise<unknown> };

async function openArticle() {
  const registered: RegisteredTool[] = [];
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: { registerTool: (tool: RegisteredTool) => registered.push(tool) },
  });
  window.history.replaceState(null, "", "?title=Test&lang=en&level=strict");
  render(<App />);
  await screen.findByRole("heading", { name: "Test article" });

  return async (name: string, input: Record<string, unknown>) => {
    const tool = registered.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`No such tool: ${name}`);
    const result = (await tool.execute(JSON.stringify(input))) as { content: { text: string }[] };
    return JSON.parse(result.content[0].text) as Record<string, never>;
  };
}

afterEach(cleanup);

describe("a section whose heading is the spoiler", () => {
  it("keeps the heading off the screen, reason and all", async () => {
    await openArticle();
    expect(screen.getByText("Heading withheld · reveal")).toBeTruthy();
    expect(document.body.textContent).not.toContain("Kira");
  });

  it("keeps it out of the list of what the agent has read", async () => {
    const call = await openArticle();
    const described = await call("describe_withheld_content", { section_id: "s1" });
    const ids = (described.hidden as unknown as { sentence_id: string }[]).map((item) => item.sentence_id);
    expect(ids.length).toBeGreaterThan(0);
    await call("reveal_withheld_sentences", { sentence_ids: ids });

    const panel = await screen.findByRole("heading", { name: "Your agent has read" });
    expect(panel.parentElement?.textContent).not.toContain("Kira");
  });

  it("shows the reader which sections the agent opened", async () => {
    const call = await openArticle();
    await call("reveal_withheld_sentences", { sentence_ids: ["p1.0"] });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Your agent has read" })).toBeTruthy());
    const report = await call("get_masking_report", {});
    expect(report.sections_the_agent_has_read).toEqual(["s1"]);
  });
});
