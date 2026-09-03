import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
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

function installAgent(holder: object = document) {
  const registered: WebMcpTool[] = [];
  const context = {
    registerTool: vi.fn((tool: WebMcpTool) => {
      registered.push(tool);
      return Promise.resolve();
    }),
    unregisterTool: vi.fn((name: string) => {
      const at = registered.findIndex((candidate) => candidate.name === name);
      if (at >= 0) registered.splice(at, 1);
      return Promise.resolve();
    }),
  };
  Object.defineProperty(holder, "modelContext", { value: context, configurable: true, writable: true });
  return { registered, context };
}

/**
 * Chrome exposes no `unregisterTool`, and a second `registerTool` for a name it
 * already holds rejects with `InvalidStateError: Duplicate tool name`.
 */
function installChromeAgent() {
  const registered: WebMcpTool[] = [];
  const context = {
    registerTool: vi.fn((tool: WebMcpTool) => {
      if (registered.some((candidate) => candidate.name === tool.name)) {
        return Promise.reject(new DOMException("Duplicate tool name", "InvalidStateError"));
      }
      registered.push(tool);
      return Promise.resolve();
    }),
  };
  Object.defineProperty(document, "modelContext", { value: context, configurable: true, writable: true });
  return { registered };
}

function installFailingAgent(error: Error) {
  Object.defineProperty(document, "modelContext", {
    value: {
      registerTool: () => Promise.reject(error),
      unregisterTool: () => Promise.resolve(),
    },
    configurable: true,
    writable: true,
  });
}

async function renderWithAgent(): Promise<WebMcpTool[]> {
  const { registered } = installAgent();
  render(<App />);
  await waitFor(() => expect(registered.length).toBeGreaterThan(0));
  return registered;
}

function toolNamed(registered: WebMcpTool[], name: string): WebMcpTool {
  const tool = registered.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  return tool;
}

async function callTool(registered: WebMcpTool[], name: string, input: Record<string, unknown> = {}) {
  let result: Record<string, unknown> = {};
  await act(async () => {
    const response = await toolNamed(registered, name).execute(JSON.stringify(input));
    result = JSON.parse(response.content[0].text) as Record<string, unknown>;
  });
  return result;
}

async function openArticle(registered: WebMcpTool[], lang: Lang, title: string) {
  const result = await callTool(registered, "open_article", { title, lang });
  await waitFor(() => screen.getByRole("heading", { level: 2, name: title }));
  return result;
}

/** A sentence the reader opened arrives a word at a time, so it is no longer one run of text. */
function articleText(): string {
  return screen.getByRole("article").textContent ?? "";
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

const TITAN = fetched(
  "en",
  "Attack on Titan",
  `<p>Attack on Titan is a Japanese manga series written and illustrated by Hajime Isayama.</p>
   <h2>Production</h2>
   <p>Isayama pitched the series to Weekly Shonen Magazine after a rejection from another publisher.</p>
   <h2>Plot</h2>
   <p>Eren Yeager lives in a walled town that is destroyed when the Colossal Titan breaches the wall.</p>`,
);

const SIXTH_SENSE = fetched(
  "en",
  "The Sixth Sense",
  `<p>The Sixth Sense is a 1999 American supernatural thriller film directed by M. Night Shyamalan.</p>
   <h2>Production</h2>
   <p>Shyamalan sold the screenplay to a studio for two and a half million dollars before filming began.</p>
   <h2>Plot</h2>
   <p>Malcolm Crowe has been a ghost since the opening scene and finally accepts it, then moves on.</p>`,
);

const ARTICLES: Record<string, FetchedArticle> = {
  "en:Attack on Titan": TITAN,
  "en:The Sixth Sense": SIXTH_SENSE,
  "ja:シックス・センス": fetched(
    "ja",
    "シックス・センス",
    `<p>『シックス・センス』は、1999年のアメリカ映画である。監督はM・ナイト・シャマラン。</p>
     <h2>あらすじ</h2>
     <p>小児精神科医のマルコム・クロウは、幽霊が見える少年コール・シアーと出会うことになる。</p>`,
  ),
};

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.mocked(fetchArticle).mockReset();
  vi.mocked(fetchArticle).mockImplementation(async (lang, title) => {
    const article = ARTICLES[`${lang}:${title}`];
    if (!article) throw new Error(`The page "${title}" does not exist.`);
    return article;
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, "modelContext");
  Reflect.deleteProperty(navigator, "modelContext");
});

describe("opening another article", () => {
  it("does not carry a decision about one article over to the next", async () => {
    const registered = await renderWithAgent();

    await openArticle(registered, "en", "Attack on Titan");
    await callTool(registered, "apply_mask", {
      show: { section_ids: ["s2"] },
      reason: "you have finished season 1",
    });
    expect(articleText()).toContain("Eren Yeager lives in a walled town");

    await openArticle(registered, "en", "The Sixth Sense");

    expect(screen.queryByText(/Malcolm Crowe has been a ghost/)).toBeNull();
    expect(screen.queryByText("you have finished season 1")).toBeNull();
  });

  it("does not let sentences hidden in one article hide sentences in the next", async () => {
    const registered = await renderWithAgent();

    await openArticle(registered, "en", "Attack on Titan");
    await callTool(registered, "apply_mask", {
      hide: { sentence_ids: ["p1.0"] },
      reason: "you do not want production details",
    });
    expect(screen.queryByText(/Isayama pitched the series/)).toBeNull();

    await openArticle(registered, "en", "The Sixth Sense");

    expect(screen.getByText(/Shyamalan sold the screenplay/)).toBeTruthy();
  });

  it("keeps the reader's sensitivity, which belongs to the reader and not the article", async () => {
    const registered = await renderWithAgent();
    await openArticle(registered, "en", "Attack on Titan");

    await userEvent.click(screen.getByRole("button", { name: "Major spoilers" }));
    await openArticle(registered, "en", "The Sixth Sense");

    const report = await callTool(registered, "get_masking_report");
    expect(report.sensitivity).toBe(45);
  });

  it("keeps what the reader has opened when the same article is opened again", async () => {
    const registered = await renderWithAgent();

    await openArticle(registered, "en", "Attack on Titan");
    await callTool(registered, "apply_mask", {
      show: { sentence_ids: ["p2.0"] },
      reason: "you have watched the first episode",
    });
    expect(articleText()).toContain("Eren Yeager lives in a walled town");

    await openArticle(registered, "en", "Attack on Titan");

    expect(articleText()).toContain("Eren Yeager lives in a walled town");
  });
});

describe("what the tools see of the page", () => {
  it("reports what the reader opened a moment ago, not the page as it was before", async () => {
    const registered = await renderWithAgent();
    await openArticle(registered, "en", "Attack on Titan");

    await userEvent.click(screen.getByRole("button", { name: /^Reveal .* chars$/ }));

    const report = await callTool(registered, "get_masking_report");
    expect(report.sentences).toEqual({ total: 3, shown: 3, hidden: 0 });
  });

  it("counts what the reader does to their own page as theirs, not as a decision of the agent's", async () => {
    const registered = await renderWithAgent();
    await openArticle(registered, "en", "Attack on Titan");

    await userEvent.click(screen.getByRole("button", { name: /^Reveal .* chars$/ }));

    expect((await callTool(registered, "get_masking_report")).decisions).toEqual([]);
  });
});

describe("exposing the tools to an agent", () => {
  it("takes its tools back when the reader leaves the page", async () => {
    const { registered, context } = installAgent();
    const view = render(<App />);
    await waitFor(() => expect(registered.length).toBeGreaterThan(0));
    const exposed = registered.length;

    view.unmount();

    await waitFor(() => expect(registered).toHaveLength(0));
    expect(context.unregisterTool).toHaveBeenCalledTimes(exposed);
  });

  it("exposes each tool once when React mounts the page twice", async () => {
    const { registered } = installChromeAgent();

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByText(/tools exposed via document.modelContext/)).toBeTruthy());
    const names = registered.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(screen.getByText(`${names.length} tools exposed via document.modelContext`)).toBeTruthy();
  });

  it("answers through the live page after React mounts it twice", async () => {
    const { registered } = installChromeAgent();

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await waitFor(() => expect(registered.length).toBeGreaterThan(0));
    await openArticle(registered, "en", "Attack on Titan");

    expect(screen.getByText(/Attack on Titan is a Japanese manga series/)).toBeTruthy();
  });

  it("tells the reader when the browser refused the tools", async () => {
    installFailingAgent(new Error("Tool limit reached"));

    render(<App />);

    await waitFor(() => expect(screen.getByText(/Tool limit reached/)).toBeTruthy());
    expect(screen.queryByText(/tools exposed via/)).toBeNull();
  });

  it("shows the reader which calls failed", async () => {
    const registered = await renderWithAgent();
    await callTool(registered, "open_article");

    const panel = screen.getByRole("heading", { name: "Tool activity" }).parentElement;
    expect(panel?.textContent).toContain("open_article");
    expect(panel?.textContent).toContain("error");
  });

  it("names the holder the tools were actually registered on", async () => {
    installAgent(navigator);

    render(<App />);

    await waitFor(() => expect(screen.getByText(/tools exposed via navigator.modelContext/)).toBeTruthy());
  });
});

describe("open_article", () => {
  it("returns the article it opened, once the fetch has finished", async () => {
    const registered = await renderWithAgent();

    const result = await callTool(registered, "open_article", { title: "Attack on Titan" });

    expect(result.title).toBe("Attack on Titan");
    expect(result.lang).toBe("en");
    expect(result.sections).toHaveLength(3);
    expect(screen.getByRole("heading", { level: 2, name: "Attack on Titan" })).toBeTruthy();
  });

  it("reports a title that does not exist instead of a successful open", async () => {
    const registered = await renderWithAgent();

    const result = await callTool(registered, "open_article", { title: "Nonexistent Film" });

    expect(String(result.error)).toContain("does not exist");
    expect(result.title).toBeUndefined();
  });

  it("has the article in place for the tools that follow it", async () => {
    const registered = await renderWithAgent();

    await callTool(registered, "open_article", { title: "Attack on Titan" });
    await callTool(registered, "open_article", { title: "The Sixth Sense" });

    const outline = await callTool(registered, "open_article");
    expect(outline.title).toBe("The Sixth Sense");
  });

  it("refuses a bare call while no article is open", async () => {
    const registered = await renderWithAgent();

    expect(String((await callTool(registered, "open_article")).error)).toContain("No article is open");
  });

  it("describes the new article under the policy that now applies to it", async () => {
    const registered = await renderWithAgent();

    await callTool(registered, "open_article", { title: "Attack on Titan" });
    await callTool(registered, "apply_mask", { show: { section_ids: ["s2"] }, reason: "finished season 1" });

    const result = await callTool(registered, "open_article", { title: "The Sixth Sense" });

    const sections = result.sections as { section_id: string; withheld: number }[];
    expect(sections.find((section) => section.section_id === "s2")?.withheld).toBe(1);
  });

  it("lets the last request win when an earlier fetch finishes after it", async () => {
    const registered = await renderWithAgent();
    const titan = deferred<FetchedArticle>();
    const sixthSense = deferred<FetchedArticle>();
    vi.mocked(fetchArticle)
      .mockImplementationOnce(() => titan.promise)
      .mockImplementationOnce(() => sixthSense.promise);

    const open = toolNamed(registered, "open_article");
    let superseded: Record<string, unknown> = {};
    await act(async () => {
      const first = open.execute(JSON.stringify({ title: "Attack on Titan" }));
      const second = open.execute(JSON.stringify({ title: "The Sixth Sense" }));
      sixthSense.resolve(SIXTH_SENSE);
      titan.resolve(TITAN);
      superseded = JSON.parse((await first).content[0].text) as Record<string, unknown>;
      await second;
    });

    expect(screen.getByRole("heading", { level: 2, name: "The Sixth Sense" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 2, name: "Attack on Titan" })).toBeNull();
    expect(superseded.superseded).toBe(true);
    expect(window.location.search).toContain("title=The+Sixth+Sense");
  });
});

describe("the record of what the agent has read", () => {
  it("survives opening the same article again", async () => {
    const registered = await renderWithAgent();

    await openArticle(registered, "en", "Attack on Titan");
    await callTool(registered, "read_article_content", { section_ids: ["s2"] });
    expect(screen.getByText(/It knows those spoilers/)).toBeTruthy();

    await openArticle(registered, "en", "Attack on Titan");

    expect(screen.getByText(/It knows those spoilers/)).toBeTruthy();
    const report = await callTool(registered, "get_masking_report");
    expect(report.sections_read).toEqual(["s2"]);
  });

  it("comes back when the reader returns to the article", async () => {
    const registered = await renderWithAgent();

    await openArticle(registered, "en", "Attack on Titan");
    await callTool(registered, "read_article_content", { section_ids: ["s2"] });

    await openArticle(registered, "en", "The Sixth Sense");
    await openArticle(registered, "en", "Attack on Titan");

    const report = await callTool(registered, "get_masking_report");
    expect(report.sections_read).toEqual(["s2"]);
  });

  it("does not report another article's sections as read in this one", async () => {
    const registered = await renderWithAgent();

    await openArticle(registered, "en", "Attack on Titan");
    await callTool(registered, "read_article_content", { section_ids: ["s2"] });

    await openArticle(registered, "en", "The Sixth Sense");

    const report = await callTool(registered, "get_masking_report");
    expect(report.sections_read).toEqual([]);
  });

  it("still tells the reader the agent read another article, by title and count", async () => {
    const registered = await renderWithAgent();

    await openArticle(registered, "en", "Attack on Titan");
    await callTool(registered, "read_article_content", { section_ids: ["s2"] });

    await openArticle(registered, "en", "The Sixth Sense");

    const panel = screen.getByRole("heading", { name: "Your agent has read" }).parentElement;
    expect(panel?.textContent).toContain("Attack on Titan — 1 section");
  });

  it("leaves the sections it read withheld on the page", async () => {
    const registered = await renderWithAgent();

    await openArticle(registered, "en", "Attack on Titan");
    await callTool(registered, "read_article_content");

    expect(screen.queryByText(/Eren Yeager lives in a walled town/)).toBeNull();
  });
});

describe("a shared link", () => {
  it("does not override the sensitivity the reader has stored", async () => {
    window.localStorage.setItem("unspoiled.sensitivity", "75");
    window.history.replaceState(null, "", "/?sensitivity=0&title=Attack%20on%20Titan");

    const registered = await renderWithAgent();
    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Attack on Titan" }));

    const report = await callTool(registered, "get_masking_report");
    expect(report.sensitivity).toBe(75);
    expect(screen.queryByText(/Eren Yeager lives in a walled town/)).toBeNull();
  });

  it("does not turn its sensitivity into the reader's stored setting", async () => {
    window.history.replaceState(null, "", "/?sensitivity=0");

    await renderWithAgent();

    expect(window.localStorage.getItem("unspoiled.sensitivity")).toBeNull();
  });

  it("sets the sensitivity for a reader who has none stored", async () => {
    window.history.replaceState(null, "", "/?sensitivity=50&title=Attack%20on%20Titan");

    const registered = await renderWithAgent();
    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Attack on Titan" }));

    const report = await callTool(registered, "get_masking_report");
    expect(report.sensitivity).toBe(50);
  });

  it("cannot choose which host the article is fetched from", async () => {
    window.history.replaceState(null, "", "/?lang=xx&title=Attack%20on%20Titan");

    await renderWithAgent();

    await waitFor(() => expect(vi.mocked(fetchArticle)).toHaveBeenCalledWith("en", "Attack on Titan"));
    expect(vi.mocked(fetchArticle)).not.toHaveBeenCalledWith("xx", "Attack on Titan");
  });

  it("still opens the article it points at", async () => {
    window.history.replaceState(null, "", `/?lang=ja&title=${encodeURIComponent("シックス・センス")}`);

    await renderWithAgent();

    await waitFor(() => screen.getByRole("heading", { level: 2, name: "シックス・センス" }));
  });
});

describe("the reader's sensitivity", () => {
  it("is stored when the reader picks a preset", async () => {
    await renderWithAgent();

    await userEvent.click(screen.getByRole("button", { name: "Major spoilers" }));

    expect(window.localStorage.getItem("unspoiled.sensitivity")).toBe("45");
  });
});
