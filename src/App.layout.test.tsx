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

describe("where the page puts each thing it has to say", () => {
  it("keeps the reader's control before the article, so the article never buries it", async () => {
    await openArticle();

    expect(precedes(screen.getByRole("complementary"), screen.getByRole("article"))).toBe(true);
  });

  it("keeps one sensitivity control, pinned to the bottom rather than drawn a second time", async () => {
    await openArticle();

    expect(screen.getAllByRole("slider")).toHaveLength(1);
  });

  it("leaves the reader's control alone in the sidebar", async () => {
    const call = await openArticle();
    await call("apply_mask", { show: { sentence_ids: ["p1.0"] }, reason: "you have seen the opening" });
    await call("read_article_content", { section_ids: ["s1"] });

    const sidebar = screen.getByRole("complementary").textContent ?? "";

    expect(sidebar).toContain("Sensitivity");
    for (const audit of ["Revealed on your page", "Your agent's decisions", "Tool activity", "Agent activity"]) {
      expect(sidebar).not.toContain(audit);
    }
  });

  /*
   * The search field is how the reader gets anywhere, so it belongs to the page rather than to the
   * column under it: in the header it is in the same place whether or not an article is open.
   */
  it("keeps the search field in the header, above everything the page shows", async () => {
    await openArticle();

    const field = screen.getByPlaceholderText("Search Wikipedia for a film, series or novel");

    expect(field.closest("header")).toBeTruthy();
    expect(precedes(screen.getByRole("banner"), screen.getByRole("main"))).toBe(true);
  });

  it("drops the strapline once there is an article to read instead", async () => {
    await openArticle();

    expect(screen.queryByText("Read Wikipedia without learning the ending.")).toBeNull();
  });

  it("says what the page is for while there is no article yet", () => {
    render(<App />);

    const strapline = screen.getByText("Read Wikipedia without learning the ending.");

    expect(strapline.closest("header")).toBeNull();
    expect(precedes(screen.getByRole("banner"), strapline)).toBe(true);
  });

  it("puts what the agent has read in front of the article and its workings after it", async () => {
    const call = await openArticle();
    await call("read_article_content", { section_ids: ["s1"] });

    const article = screen.getByRole("article");
    const drawer = screen.getByText(/^Agent activity ·/);

    expect(precedes(screen.getByText(/^Your agent has read:/), article.querySelector("section") as Element)).toBe(true);
    expect(precedes(article, drawer)).toBe(true);
    expect(precedes(drawer, screen.getByRole("contentinfo"))).toBe(true);
  });
});
