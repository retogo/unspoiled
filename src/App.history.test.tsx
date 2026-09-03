import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { fetchArticle, type FetchedArticle, type Lang } from "./lib/wikipedia";

vi.mock("./lib/wikipedia", () => ({
  fetchArticle: vi.fn(),
  searchArticles: vi.fn(),
}));

type WebMcpTool = {
  name: string;
  execute: (raw: unknown) => Promise<{ content: { type: string; text: string }[] }>;
};

function installAgent() {
  const registered: WebMcpTool[] = [];
  Object.defineProperty(document, "modelContext", {
    value: { registerTool: (tool: WebMcpTool) => Promise.resolve(registered.push(tool)) },
    configurable: true,
    writable: true,
  });
  return registered;
}

async function renderWithAgent(): Promise<WebMcpTool[]> {
  const registered = installAgent();
  render(<App />);
  await waitFor(() => expect(registered.length).toBeGreaterThan(0));
  return registered;
}

async function callTool(registered: WebMcpTool[], name: string, input: Record<string, unknown> = {}) {
  const tool = registered.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  let result: Record<string, unknown> = {};
  await act(async () => {
    const response = await tool.execute(JSON.stringify(input));
    result = JSON.parse(response.content[0].text) as Record<string, unknown>;
  });
  return result;
}

async function openArticle(registered: WebMcpTool[], language: Lang, title: string) {
  const result = await callTool(registered, "open_article", { title, language });
  await waitFor(() => screen.getByRole("heading", { level: 2, name: title }));
  return result;
}

/** The browser moving to another entry: the URL is already the old one by the time the page hears. */
async function browserGoesTo(search: string) {
  await act(async () => {
    history.replaceState(null, "", search);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function fetched(lang: Lang, title: string, html: string): FetchedArticle {
  return {
    lang,
    title,
    displayTitle: title,
    sourceUrl: `https://${lang}.wikipedia.org/wiki/${title}`,
    html: `<div class="mw-parser-output">${html}</div>`,
  };
}

const ARTICLES: Record<string, FetchedArticle> = {
  "en:Attack on Titan": fetched(
    "en",
    "Attack on Titan",
    `<p>Attack on Titan is a Japanese manga series written and illustrated by Hajime Isayama.</p>`,
  ),
  "en:The Sixth Sense": fetched(
    "en",
    "The Sixth Sense",
    `<p>The Sixth Sense is a 1999 American supernatural thriller film directed by M. Night Shyamalan.</p>`,
  ),
  "ja:シックス・センス": fetched(
    "ja",
    "シックス・センス",
    `<p>『シックス・センス』は、1999年のアメリカ映画である。監督はM・ナイト・シャマラン。</p>`,
  ),
};

let pushState: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  window.localStorage.clear();
  history.replaceState(null, "", "/");
  vi.mocked(fetchArticle).mockReset();
  vi.mocked(fetchArticle).mockImplementation(async (lang, title) => {
    const article = ARTICLES[`${lang}:${title}`];
    if (!article) throw new Error(`The page "${title}" does not exist.`);
    return article;
  });
  pushState = vi.spyOn(window.history, "pushState");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "modelContext");
});

describe("the history entries the reader can go back through", () => {
  it("gives another article its own entry", async () => {
    const registered = await renderWithAgent();

    await openArticle(registered, "en", "Attack on Titan");
    await openArticle(registered, "en", "The Sixth Sense");

    expect(pushState).toHaveBeenCalledTimes(2);
    expect(String(pushState.mock.calls[1][2])).toContain("title=The+Sixth+Sense");
    expect(window.location.search).toContain("title=The+Sixth+Sense");
  });

  it("does not add an entry when the same article is opened again", async () => {
    const registered = await renderWithAgent();
    await openArticle(registered, "en", "Attack on Titan");
    pushState.mockClear();

    await openArticle(registered, "en", "Attack on Titan");

    expect(pushState).not.toHaveBeenCalled();
    expect(window.location.search).toContain("title=Attack+on+Titan");
  });

  it("does not add an entry when the reader moves the sensitivity", async () => {
    const registered = await renderWithAgent();
    await openArticle(registered, "en", "Attack on Titan");
    pushState.mockClear();

    fireEvent.change(screen.getByRole("slider"), { target: { value: "20" } });

    expect(pushState).not.toHaveBeenCalled();
    expect(window.location.search).toContain("sensitivity=20");
  });

  it("does not add an entry for the article a shared link already names", async () => {
    history.replaceState(null, "", "?lang=ja&title=%E3%82%B7%E3%83%83%E3%82%AF%E3%82%B9%E3%83%BB%E3%82%BB%E3%83%B3%E3%82%B9");

    installAgent();
    render(<App />);
    await screen.findByRole("heading", { level: 2, name: "シックス・センス" });

    expect(pushState).not.toHaveBeenCalled();
    expect(window.location.search).toContain("title=%E3%82%B7%E3%83%83%E3%82%AF%E3%82%B9%E3%83%BB%E3%82%BB%E3%83%B3%E3%82%B9");
  });

  it("does not add an entry for an article that failed to open", async () => {
    const registered = await renderWithAgent();

    await callTool(registered, "open_article", { title: "Nonexistent Film" });

    expect(pushState).not.toHaveBeenCalled();
  });
});

describe("going back", () => {
  it("opens the article the previous entry names", async () => {
    const registered = await renderWithAgent();
    await openArticle(registered, "en", "Attack on Titan");
    await openArticle(registered, "en", "The Sixth Sense");
    pushState.mockClear();

    await browserGoesTo("?sensitivity=50&lang=en&title=Attack+on+Titan");

    await screen.findByRole("heading", { level: 2, name: "Attack on Titan" });
    expect(vi.mocked(fetchArticle)).toHaveBeenLastCalledWith("en", "Attack on Titan");
  });

  it("does not add an entry for the move the browser has already made", async () => {
    const registered = await renderWithAgent();
    await openArticle(registered, "en", "Attack on Titan");
    await openArticle(registered, "en", "The Sixth Sense");
    pushState.mockClear();

    await browserGoesTo("?sensitivity=50&lang=en&title=Attack+on+Titan");
    await screen.findByRole("heading", { level: 2, name: "Attack on Titan" });

    expect(pushState).not.toHaveBeenCalled();
  });

  it("keeps the sensitivity the reader is reading at, not the one in the old URL", async () => {
    const registered = await renderWithAgent();
    await openArticle(registered, "en", "Attack on Titan");
    fireEvent.change(screen.getByRole("slider"), { target: { value: "20" } });
    await openArticle(registered, "en", "The Sixth Sense");

    await browserGoesTo("?sensitivity=95&lang=en&title=Attack+on+Titan");
    await screen.findByRole("heading", { level: 2, name: "Attack on Titan" });

    await waitFor(() => expect(window.location.search).toContain("sensitivity=20"));
  });

  it("closes the article when the entry names none", async () => {
    const registered = await renderWithAgent();
    await openArticle(registered, "en", "Attack on Titan");

    await browserGoesTo("?sensitivity=50");

    await waitFor(() =>
      expect(screen.queryByRole("heading", { level: 2, name: "Attack on Titan" })).toBeNull(),
    );
  });

  it("leaves an article still being fetched behind", async () => {
    const registered = await renderWithAgent();
    await openArticle(registered, "en", "Attack on Titan");
    const slow = deferred<FetchedArticle>();
    vi.mocked(fetchArticle).mockImplementationOnce(() => slow.promise);

    const opening = callTool(registered, "open_article", { title: "The Sixth Sense" });
    await browserGoesTo("?sensitivity=50");
    await act(async () => {
      slow.resolve(ARTICLES["en:The Sixth Sense"]);
      await opening;
    });

    expect(screen.queryByRole("heading", { level: 2, name: "The Sixth Sense" })).toBeNull();
  });
});
