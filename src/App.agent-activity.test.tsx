import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { fetchArticle, type FetchedArticle } from "./lib/wikipedia";

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
     <h2>Reception</h2>
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

function installAgent(): WebMcpTool[] {
  const registered: WebMcpTool[] = [];
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    writable: true,
    value: {
      registerTool: (tool: WebMcpTool) => {
        registered.push(tool);
        return Promise.resolve();
      },
    },
  });
  return registered;
}

function caller(registered: WebMcpTool[]) {
  return async (name: string, input: Record<string, unknown> = {}) => {
    const tool = registered.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`Tool not registered: ${name}`);
    await act(async () => {
      await tool.execute(JSON.stringify(input));
    });
  };
}

async function readerWithAgent() {
  const registered = installAgent();
  render(<App />);
  await waitFor(() => expect(registered.length).toBeGreaterThan(0));
  const call = caller(registered);

  const open = async (title: string) => {
    await call("open_article", { title, lang: "en" });
    await waitFor(() => screen.getByRole("heading", { level: 2, name: title }));
  };

  await open("The Test Film");
  return { call, open };
}

function warning(): HTMLElement | null {
  return screen.queryByText(/^Your agent has read:/);
}

function drawer(): HTMLDetailsElement {
  return screen.getByText(/^Agent activity ·/).parentElement as HTMLDetailsElement;
}

function notice(): string {
  return screen.getByRole("status").textContent ?? "";
}

function precedes(first: Element, second: Element): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
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
  vi.useRealTimers();
  Reflect.deleteProperty(document, "modelContext");
});

describe("what the agent has read, in front of the article", () => {
  it("says nothing while the agent has read nothing", async () => {
    await readerWithAgent();

    expect(warning()).toBeNull();
  });

  it("names the section the agent read, and what having read it means", async () => {
    const { call } = await readerWithAgent();

    await call("read_article_content", { section_ids: ["s1"] });

    expect(screen.getByText("Your agent has read: Plot")).toBeTruthy();
    expect(
      screen.getByText(
        "In this conversation your agent knows what those sections say, even where the page still withholds them.",
      ),
    ).toBeTruthy();
  });

  it("names every section it read in one line, the lead among them", async () => {
    const { call } = await readerWithAgent();

    await call("read_article_content", { section_ids: ["s0", "s2"] });

    expect(screen.getByText("Your agent has read: Lead section, Reception")).toBeTruthy();
  });

  it("stands in front of the article rather than beside it", async () => {
    const { call } = await readerWithAgent();
    await call("read_article_content", { section_ids: ["s1"] });

    const banner = warning() as HTMLElement;

    expect(screen.getByRole("article").contains(banner)).toBe(true);
    expect(precedes(banner, screen.getByRole("heading", { name: "Reception" }))).toBe(true);
  });

  it("carries nothing to dismiss it with", async () => {
    const { call } = await readerWithAgent();
    await call("read_article_content", { section_ids: ["s1"] });

    const banner = warning()?.parentElement as HTMLElement;

    expect(banner.querySelector("button")).toBeNull();
  });

  it("goes with the article the reader leaves, and comes back with it", async () => {
    const { call, open } = await readerWithAgent();
    await call("read_article_content", { section_ids: ["s1"] });

    await open("Another Film");
    expect(warning()).toBeNull();

    await open("The Test Film");
    expect(screen.getByText("Your agent has read: Plot")).toBeTruthy();
  });
});

describe("a decision announcing itself as it lands", () => {
  it("says how much it moved, and why", async () => {
    const { call } = await readerWithAgent();

    await call("apply_mask", { show: { sentence_ids: ["p1.0"] }, reason: "you have watched the first act" });

    expect(notice()).toContain("Your agent showed 1 sentence and hid 0");
    expect(notice()).toContain("you have watched the first act");
  });

  it("stays a good while, and then goes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { call } = await readerWithAgent();
    await call("apply_mask", { show: { sentence_ids: ["p1.0"] }, reason: "you have watched the first act" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(notice()).toContain("Your agent showed 1 sentence and hid 0");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(notice()).toBe("");
  });

  it("waits while the reader has the pointer on it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { call } = await readerWithAgent();
    await call("apply_mask", { show: { sentence_ids: ["p1.0"] }, reason: "you have watched the first act" });

    const held = screen.getByRole("button", { name: /Your agent showed/ });
    await user.hover(held);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(notice()).toContain("Your agent showed 1 sentence and hid 0");

    await user.unhover(held);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12000);
    });
    expect(notice()).toBe("");
  });

  it("waits while it holds the focus, so a reader on the keyboard can read it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { call } = await readerWithAgent();
    await call("apply_mask", { show: { sentence_ids: ["p1.0"] }, reason: "you have watched the first act" });

    const held = screen.getByRole("button", { name: /Your agent showed/ });
    await act(async () => {
      held.focus();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(notice()).toContain("Your agent showed 1 sentence and hid 0");

    await act(async () => {
      held.blur();
      await vi.advanceTimersByTimeAsync(12000);
    });
    expect(notice()).toBe("");
  });

  it("leaves only the newest of two decisions in a row", async () => {
    const { call } = await readerWithAgent();

    await call("apply_mask", { show: { sentence_ids: ["p1.0"] }, reason: "you have watched the first act" });
    await call("apply_mask", { hide: { sentence_ids: ["p0.0"] }, reason: "you asked not to know the year" });

    expect(notice()).toContain("you asked not to know the year");
    expect(notice()).not.toContain("you have watched the first act");
  });

  it("stays quiet when the reader opens a sentence themselves", async () => {
    await readerWithAgent();

    await userEvent.click(screen.getByRole("button", { name: /Reveal 2 sentences withheld/ }));

    expect(screen.queryByRole("button", { name: /Reveal 2 sentences withheld/ })).toBeNull();
    expect(notice()).toBe("");
  });

  it("opens the activity drawer when the reader taps it", async () => {
    const { call } = await readerWithAgent();
    await call("apply_mask", { show: { sentence_ids: ["p1.0"] }, reason: "you have watched the first act" });

    await userEvent.click(screen.getByRole("button", { name: /Your agent showed/ }));

    expect(drawer().open).toBe(true);
  });
});

describe("the activity drawer under the article", () => {
  it("is folded away, and says how much it holds", async () => {
    await readerWithAgent();

    expect(screen.getByText("Agent activity · 0 decisions · 1 call")).toBeTruthy();
    expect(drawer().open).toBe(false);
  });

  it("counts the decisions and the calls behind it", async () => {
    const { call } = await readerWithAgent();

    await call("apply_mask", { show: { sentence_ids: ["p1.0"] }, reason: "you have watched the first act" });
    await call("get_masking_report");

    expect(screen.getByText("Agent activity · 1 decision · 3 calls")).toBeTruthy();
  });

  it("states each decision with the time, the counts and the reason, newest first", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 0, 2, 9, 5));
    const { call } = await readerWithAgent();

    await call("apply_mask", { show: { section_ids: ["s1"] }, reason: "you have watched the first act" });
    await call("apply_mask", { hide: { sentence_ids: ["p0.0"] }, reason: "you asked not to know the year" });

    const rows = screen.getByRole("heading", { name: "Decisions" }).parentElement?.querySelectorAll("li");
    expect(rows?.[0].textContent).toContain("09:05 · 0 shown · 1 hidden");
    expect(rows?.[0].textContent).toContain("you asked not to know the year");
    expect(rows?.[1].textContent).toContain("2 shown · 0 hidden");
  });

  it("lists the calls the agent made, the failures marked", async () => {
    const { call } = await readerWithAgent();

    await call("read_article_content", { section_ids: ["s9"] });

    const calls = screen.getByRole("heading", { name: "Tool calls" }).parentElement?.textContent ?? "";
    expect(calls).toContain("read_article_content");
    expect(calls).toContain("error");
  });

  it("keeps a decision that reached nothing, rather than letting it pass in silence", async () => {
    const { call } = await readerWithAgent();

    await call("apply_mask", { hide: { sentence_ids: ["p9.9"] }, reason: "you asked not to know the ending" });

    const rows = screen.getByRole("heading", { name: "Decisions" }).parentElement?.querySelectorAll("li");
    expect(rows?.[0].textContent).toContain("0 shown · 0 hidden");
    expect(rows?.[0].textContent).toContain("you asked not to know the ending");
  });

  it("holds every decision of the session, in order, once the reader has moved on", async () => {
    const { call, open } = await readerWithAgent();
    await call("apply_mask", { show: { sentence_ids: ["p1.0"] }, reason: "you have watched the first act" });

    await open("Another Film");
    await call("apply_mask", { hide: { sentence_ids: ["p1.1"] }, reason: "you asked not to know the courier's errand" });

    const rows = screen.getByRole("heading", { name: "Decisions" }).parentElement?.querySelectorAll("li");
    expect(rows).toHaveLength(2);
    expect(rows?.[0].textContent).toContain("you asked not to know the courier's errand");
    expect(rows?.[1].textContent).toContain("you have watched the first act");
    expect(screen.getByText(/^Agent activity · 2 decisions/)).toBeTruthy();
  });

  it("is not there before an article is open", async () => {
    installAgent();
    render(<App />);

    await waitFor(() => expect(screen.getByRole("complementary")).toBeTruthy());
    expect(screen.queryByText(/^Agent activity ·/)).toBeNull();
  });

  it("keeps a count of the sections read in an article the reader has left", async () => {
    const { call, open } = await readerWithAgent();
    await call("read_article_content", { section_ids: ["s1"] });

    await open("Another Film");

    const elsewhere = screen.getByRole("heading", { name: "Read elsewhere" }).parentElement?.textContent ?? "";
    expect(elsewhere).toContain("The Test Film — 1 section");
  });
});
