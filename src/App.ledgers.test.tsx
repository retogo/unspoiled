import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { fetchArticle, type FetchedArticle, type Lang } from "./lib/wikipedia";

vi.mock("./lib/wikipedia", () => ({
  fetchArticle: vi.fn(),
  searchArticles: vi.fn(),
}));

function fetched(title: string, html: string): FetchedArticle {
  return {
    lang: "en",
    title,
    displayTitle: title,
    sourceUrl: `https://en.wikipedia.org/wiki/${title}`,
    html: `<div class="mw-parser-output">${html}</div>`,
  };
}

const ARTICLES: Record<string, FetchedArticle> = {
  "The Test Film": fetched(
    "The Test Film",
    `<p>The film was released in 1999 and became a sleeper hit around the world.</p>
     <h2>Plot</h2>
     <p>A boy meets a doctor in a small town. The doctor listens to him for weeks on end.</p>
     <h2>Ending: Kira loses</h2>
     <p>The detective writes his own name in the notebook and waits for the forty seconds to pass.</p>`,
  ),
  "Another Film": fetched(
    "Another Film",
    `<p>Another film opened the same summer and ran for eleven weeks in cinemas.</p>
     <h2>Plot</h2>
     <p>A courier carries a package across the city. She never opens it until the last night.</p>`,
  ),
};

type WebMcpTool = {
  name: string;
  execute: (raw: unknown) => Promise<{ content: { type: string; text: string }[] }>;
};

async function readerWithAgent() {
  const registered: WebMcpTool[] = [];
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    writable: true,
    value: {
      registerTool: (tool: WebMcpTool) => {
        registered.push(tool);
        return Promise.resolve();
      },
      unregisterTool: () => Promise.resolve(),
    },
  });
  render(<App />);
  await waitFor(() => expect(registered.length).toBeGreaterThan(0));

  const call = async (name: string, input: Record<string, unknown> = {}) => {
    const tool = registered.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`Tool not registered: ${name}`);
    let result: Record<string, unknown> = {};
    await act(async () => {
      const response = await tool.execute(JSON.stringify(input));
      result = JSON.parse(response.content[0].text) as Record<string, unknown>;
    });
    return result;
  };

  const open = async (title: string) => {
    await call("open_article", { title, language: "en" as Lang });
    await waitFor(() => screen.getByRole("heading", { level: 2, name: title }));
  };

  await open("The Test Film");
  return { call, open };
}

function ledger(name: string): string {
  return screen.getByRole("heading", { name }).parentElement?.textContent ?? "";
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.mocked(fetchArticle).mockReset();
  vi.mocked(fetchArticle).mockImplementation(async (_lang, title) => {
    const article = ARTICLES[title];
    if (!article) throw new Error(`The page "${title}" does not exist.`);
    return article;
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, "modelContext");
});

describe("the two disclosure ledgers", () => {
  it("stands both of them up empty before anything is disclosed", async () => {
    await readerWithAgent();

    expect(ledger("Revealed on your page")).toContain("Nothing yet");
    expect(ledger("Text sent to your agent")).toContain("Nothing yet");
  });

  it("lists a sentence the agent opened in both ledgers", async () => {
    const { call } = await readerWithAgent();

    await call("reveal_withheld_sentences", { sentence_ids: ["p1.0"] });

    expect(ledger("Revealed on your page")).toContain("Plot — 1 sentence");
    expect(ledger("Text sent to your agent")).toContain("Plot — 1 sentence");
  });

  it("sends nothing when the agent reveals a sentence that was already on screen", async () => {
    const { call } = await readerWithAgent();

    await call("reveal_withheld_sentences", { sentence_ids: ["p0.0"] });

    expect(ledger("Text sent to your agent")).toContain("Nothing yet");
  });

  it("counts a section read in full as sent without opening it on the page", async () => {
    const { call } = await readerWithAgent();

    await call("read_withheld_section", { section_id: "s1", acknowledge: true });

    expect(ledger("Text sent to your agent")).toContain("Plot — 2 sentences");
    expect(ledger("Revealed on your page")).toContain("Nothing yet");
    expect(screen.queryByText(/A boy meets a doctor/)).toBeNull();
  });

  it("never names a withheld heading in either ledger", async () => {
    const { call } = await readerWithAgent();

    await call("read_withheld_section", { section_id: "s2", acknowledge: true });

    expect(ledger("Text sent to your agent")).toContain("a section whose heading is withheld —");
    expect(document.body.textContent).not.toContain("Kira");
  });

  it("keeps a count of the text sent from an article the reader has left", async () => {
    const { call, open } = await readerWithAgent();
    await call("read_withheld_section", { section_id: "s1", acknowledge: true });

    await open("Another Film");

    expect(ledger("Text sent to your agent")).toContain("The Test Film — 2 sentences");
    expect(ledger("Text sent to your agent")).not.toContain("Plot");
  });
});
