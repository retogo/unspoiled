import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { fetchArticle, type FetchedArticle, type Lang } from "./lib/wikipedia";

vi.mock("./lib/wikipedia", () => ({
  fetchArticle: vi.fn(),
  searchArticles: vi.fn(),
}));

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
  "en:Fight Club (film)": fetched(
    "en",
    "Fight Club (film)",
    `<p>Fight Club is a 1999 film directed by David Fincher.</p>
     <h2>Production</h2>
     <p>Pitt was cast after the studio agreed to the budget.</p>`,
  ),
  "en:The Sixth Sense": fetched(
    "en",
    "The Sixth Sense",
    `<p>The Sixth Sense is a 1999 film directed by M. Night Shyamalan.</p>
     <h2>Production</h2>
     <p>Willis signed on once the studio approved the script.</p>`,
  ),
};

const PITT = /Pitt was cast/;
const WILLIS = /Willis signed on/;

beforeEach(() => {
  window.localStorage.clear();
  history.replaceState(null, "", "/");
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
});

async function open(title: string) {
  history.replaceState(null, "", `?lang=en&title=${encodeURIComponent(title)}`);
  render(<App />);
  await screen.findByRole("heading", { level: 2, name: title });
}

/** The reader following a link on the page, which is how they reach a second article here. */
async function goTo(title: string) {
  await act(async () => {
    history.replaceState(null, "", `?lang=en&title=${encodeURIComponent(title)}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await screen.findByRole("heading", { level: 2, name: title });
}

function field(): HTMLElement {
  return screen.getByLabelText("A word or phrase to always hide");
}

async function add(phrase: string) {
  await userEvent.type(field(), phrase);
  await userEvent.keyboard("{Enter}");
}

/** What the article says right now, with a revealed sentence's words joined back together. */
function articleText(): string {
  return screen.getByRole("article").textContent ?? "";
}

function ruleList(): HTMLElement {
  return screen.getByRole("list", { name: "Phrases always hidden" });
}

function stored(): string | null {
  return window.localStorage.getItem("unspoiled.rules");
}

describe("a phrase the reader always wants hidden", () => {
  it("takes down a sentence the page had nothing against", async () => {
    await open("Fight Club (film)");
    expect(screen.getByText(PITT)).toBeTruthy();

    await add("studio");

    expect(screen.queryByText(PITT)).toBeNull();
    expect(document.body.textContent).not.toContain("agreed to the budget");
  });

  it("leaves the field empty for the next phrase", async () => {
    await open("Fight Club (film)");

    await add("studio");

    expect((field() as HTMLInputElement).value).toBe("");
  });

  it("lists the phrase the reader typed, and where it applies", async () => {
    await open("Fight Club (film)");

    await add("studio");

    expect(within(ruleList()).getByText("studio")).toBeTruthy();
    expect(within(ruleList()).getByText(/this article/)).toBeTruthy();
  });

  it("says how much of the article it reaches", async () => {
    await open("Fight Club (film)");

    await add("studio");

    expect(within(ruleList()).getByText(/1 sentence withheld/)).toBeTruthy();
  });

  it("gives way to the reader tapping the sentence back", async () => {
    await open("Fight Club (film)");
    await add("studio");

    await userEvent.click(screen.getByRole("button", { name: /Reveal 1 sentence withheld/ }));

    expect(articleText()).toMatch(PITT);
  });

  it("adds nothing for a phrase that is only spaces", async () => {
    await open("Fight Club (film)");

    await add("   ");

    expect(stored()).toBeNull();
  });

  it("comes back off the page when the reader removes it", async () => {
    await open("Fight Club (film)");
    await add("studio");

    await userEvent.click(screen.getByRole("button", { name: "Stop hiding studio" }));

    expect(screen.getByText(PITT)).toBeTruthy();
  });
});

describe("where a phrase applies", () => {
  it("holds only on the article it was made on", async () => {
    await open("Fight Club (film)");
    await add("studio");

    await goTo("The Sixth Sense");

    expect(screen.getByText(WILLIS)).toBeTruthy();
  });

  it("comes back with the article it was made on", async () => {
    await open("Fight Club (film)");
    await add("studio");
    await goTo("The Sixth Sense");

    await goTo("Fight Club (film)");

    expect(screen.queryByText(PITT)).toBeNull();
  });

  it("follows the reader to every article when they say so", async () => {
    await open("Fight Club (film)");

    await userEvent.click(screen.getByRole("button", { name: "Every article" }));
    await add("studio");
    await goTo("The Sixth Sense");

    expect(screen.queryByText(WILLIS)).toBeNull();
  });

  it("offers only the scope that means anything while no article is open", async () => {
    render(<App />);

    expect(screen.queryByRole("button", { name: "This article only" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Every article" })).toBeNull();
  });
});

type WebMcpTool = {
  name: string;
  execute: (raw: unknown) => Promise<{ content: { type: string; text: string }[] }>;
};

function installAgent(): WebMcpTool[] {
  const registered: WebMcpTool[] = [];
  Object.defineProperty(document, "modelContext", {
    value: { registerTool: (tool: WebMcpTool) => Promise.resolve(registered.push(tool)) },
    configurable: true,
    writable: true,
  });
  return registered;
}

async function openWithAgent(title: string): Promise<WebMcpTool[]> {
  const registered = installAgent();
  await open(title);
  await waitFor(() => expect(registered.length).toBeGreaterThan(0));
  return registered;
}

async function callTool(registered: WebMcpTool[], name: string, input: Record<string, unknown>) {
  const tool = registered.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  await act(async () => {
    await tool.execute(JSON.stringify(input));
  });
}

const AGENTS_RULE = {
  phrases: ["studio"],
  label: "How the film came to be made",
  reason: "you said you want to watch it cold",
};

describe("a rule the reader's agent added", () => {
  it("withholds the sentences it reaches", async () => {
    const registered = await openWithAgent("Fight Club (film)");

    await callTool(registered, "add_rules", { rules: [AGENTS_RULE] });

    expect(screen.queryByText(PITT)).toBeNull();
  });

  it("tells the reader what it covers and why, in the agent's own words", async () => {
    const registered = await openWithAgent("Fight Club (film)");

    await callTool(registered, "add_rules", { rules: [AGENTS_RULE] });

    expect(within(ruleList()).getByText("How the film came to be made")).toBeTruthy();
    expect(within(ruleList()).getByText("you said you want to watch it cold")).toBeTruthy();
    expect(within(ruleList()).getByText(/1 sentence withheld/)).toBeTruthy();
  });

  it("keeps the phrases off the screen until the reader asks for them", async () => {
    const registered = await openWithAgent("Fight Club (film)");

    await callTool(registered, "add_rules", { rules: [AGENTS_RULE] });

    expect(within(ruleList()).queryByText("studio")).toBeNull();
  });

  it("keeps the phrases out of the record of the call as well", async () => {
    const registered = await openWithAgent("Fight Club (film)");

    await callTool(registered, "add_rules", { rules: [AGENTS_RULE] });

    expect(screen.getByText(/How the film came to be made →/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('"studio"');
  });

  it("shows them when the reader does ask, and takes them back on a tap", async () => {
    const registered = await openWithAgent("Fight Club (film)");
    await callTool(registered, "add_rules", { rules: [AGENTS_RULE] });

    await userEvent.click(screen.getByRole("button", { name: /may contain spoilers/ }));
    expect(within(ruleList()).getByText("studio")).toBeTruthy();

    await userEvent.click(within(ruleList()).getByText("studio"));
    expect(within(ruleList()).queryByText("studio")).toBeNull();
  });

  it("is one the reader can take down like their own", async () => {
    const registered = await openWithAgent("Fight Club (film)");
    await callTool(registered, "add_rules", { rules: [AGENTS_RULE] });

    await userEvent.click(screen.getByRole("button", { name: "Stop hiding How the film came to be made" }));

    expect(articleText()).toMatch(PITT);
  });

  it("appears among the decisions the reader can read back", async () => {
    const registered = await openWithAgent("Fight Club (film)");

    await callTool(registered, "add_rules", { rules: [AGENTS_RULE] });

    const decisions = screen.getByRole("heading", { name: "Decisions" }).parentElement;
    expect(decisions?.textContent).toContain("you said you want to watch it cold");
    expect(decisions?.textContent).toContain("How the film came to be made");
    expect(decisions?.textContent).not.toContain("studio");
  });
});

describe("rules the reader has kept", () => {
  it("are still theirs the next time the page opens", async () => {
    await open("Fight Club (film)");
    await add("studio");
    cleanup();

    await open("Fight Club (film)");

    await waitFor(() => expect(screen.queryByText(PITT)).toBeNull());
  });

  it("are written down where the reader's other settings are", async () => {
    await open("Fight Club (film)");

    await add("studio");

    expect(JSON.parse(stored() ?? "{}")).toMatchObject({
      byArticle: { "en:Fight Club (film)": [{ phrases: ["studio"], scope: "article", origin: "reader" }] },
    });
  });

  it("ignores a stored value it cannot read", async () => {
    window.localStorage.setItem("unspoiled.rules", "{{{");

    await open("Fight Club (film)");

    expect(screen.getByText(PITT)).toBeTruthy();
  });
});
