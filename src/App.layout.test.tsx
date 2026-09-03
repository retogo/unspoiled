import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const HTML = `<div class="mw-parser-output">
  <p>The Sixth Sense is a 1999 American supernatural thriller film directed by M. Night Shyamalan.</p>
  <h2>Plot</h2>
  <p>Malcolm Crowe is shot by a former patient in his own home one winter night.</p>
  <p>Malcolm understands that he has been a ghost since the opening scene.</p>
</div>`;

vi.mock("./lib/wikipedia", () => ({
  fetchArticle: async () => ({
    lang: "en",
    title: "The Sixth Sense",
    displayTitle: "The Sixth Sense",
    sourceUrl: "https://en.wikipedia.org/wiki/The_Sixth_Sense",
    html: HTML,
  }),
  searchArticles: async () => [],
}));

type WebMcpTool = {
  name: string;
  execute: (raw: unknown) => Promise<{ content: { type: string; text: string }[] }>;
};

async function openArticle() {
  const registered: WebMcpTool[] = [];
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    writable: true,
    value: { registerTool: (tool: WebMcpTool) => registered.push(tool) },
  });
  window.history.replaceState(null, "", "?title=The%20Sixth%20Sense&lang=en&sensitivity=75");
  render(<App />);
  await screen.findByRole("heading", { level: 2, name: "The Sixth Sense" });

  return async (name: string, input: Record<string, unknown> = {}) => {
    const tool = registered.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`No such tool: ${name}`);
    await act(async () => {
      await tool.execute(JSON.stringify(input));
    });
  };
}

function precedes(first: Element, second: Element): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, "modelContext");
});

describe("the reader's controls on a narrow screen", () => {
  it("comes before the article, so the article never buries it", async () => {
    await openArticle();

    expect(precedes(screen.getByRole("complementary"), screen.getByRole("article"))).toBe(true);
  });

  it("folds the ledgers and the tool log away, each summary saying how much it holds", async () => {
    await openArticle();

    const summaries = [
      "Your agent's decisions · 0",
      "Revealed on your page · 0",
      "Your agent has read · 0",
      "Tool activity · 0",
    ];
    for (const summary of summaries) {
      const found = screen.getByText(summary);
      expect(found.tagName).toBe("SUMMARY");
      expect((found.parentElement as HTMLDetailsElement).open).toBe(false);
    }
  });

  it("counts what each panel holds as the agent decides and reads", async () => {
    const call = await openArticle();

    await call("apply_mask", { show: { sentence_ids: ["p1.0"] }, reason: "you have seen the opening" });
    await call("read_article_content", { section_ids: ["s1"] });

    expect(screen.getByText("Your agent's decisions · 1")).toBeTruthy();
    expect(screen.getByText("Revealed on your page · 1")).toBeTruthy();
    expect(screen.getByText("Your agent has read · 1")).toBeTruthy();
  });

  it("counts the calls the agent has made", async () => {
    const call = await openArticle();

    await call("get_masking_report");
    await call("get_masking_report");

    expect(screen.getByText("Tool activity · 2")).toBeTruthy();
  });

  it("keeps one sensitivity control, pinned to the bottom rather than drawn a second time", async () => {
    await openArticle();

    expect(screen.getAllByRole("slider")).toHaveLength(1);
  });

  it("keeps the folded rows in the page, so nothing has to be opened to be read out", async () => {
    const call = await openArticle();

    await call("apply_mask", { show: { sentence_ids: ["p1.0"] }, reason: "you have seen the opening" });

    expect(screen.getByRole("heading", { name: "Revealed on your page" }).parentElement?.textContent).toContain(
      "Plot — 1 sentence",
    );
  });
});
