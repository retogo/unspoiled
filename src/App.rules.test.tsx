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
     <p>Willis signed on once the studio approved the script.</p>
     <p>The studio moved the date twice while casting continued.</p>`,
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

  it("lists the phrase the reader typed", async () => {
    await open("Fight Club (film)");

    await add("studio");

    expect(within(ruleList()).getByText("studio")).toBeTruthy();
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

/**
 * A rule is phrases rather than sentence ids, so nothing about it belongs to one article: it holds
 * wherever the reader goes next. What is recounted there is how far it reaches on the page in front
 * of them.
 */
describe("a phrase on the article the reader moves on to", () => {
  it("holds there too, without the page being reloaded", async () => {
    await open("Fight Club (film)");
    await add("studio");

    await goTo("The Sixth Sense");

    expect(screen.queryByText(WILLIS)).toBeNull();
  });

  it("still holds on the article it was made on", async () => {
    await open("Fight Club (film)");
    await add("studio");
    await goTo("The Sixth Sense");

    await goTo("Fight Club (film)");

    expect(screen.queryByText(PITT)).toBeNull();
  });

  it("counts the sentences of the article now open", async () => {
    await open("Fight Club (film)");
    await add("studio");
    expect(within(ruleList()).getByText("1 sentence withheld")).toBeTruthy();

    await goTo("The Sixth Sense");

    expect(within(ruleList()).getByText("2 sentences withheld")).toBeTruthy();
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

/**
 * A rule survives an article change and its ids do not, so this is where the two parts of the
 * design meet: the rule is matched against whatever is on screen now, and what the reader is told
 * about it is recounted for that article rather than carried over from the last one.
 */
describe("an agent's rule when the reader moves on to another article", () => {
  it("holds on the next article without the page being reloaded", async () => {
    const registered = await openWithAgent("Fight Club (film)");
    await callTool(registered, "add_rules", { rules: [AGENTS_RULE] });

    await goTo("The Sixth Sense");

    expect(screen.queryByText(WILLIS)).toBeNull();
  });

  it("still holds on the article it was made on", async () => {
    const registered = await openWithAgent("Fight Club (film)");
    await callTool(registered, "add_rules", { rules: [AGENTS_RULE] });
    await goTo("The Sixth Sense");

    await goTo("Fight Club (film)");

    expect(screen.queryByText(PITT)).toBeNull();
  });

  it("counts the sentences of the article now open, not the one it was made on", async () => {
    const registered = await openWithAgent("Fight Club (film)");
    await callTool(registered, "add_rules", { rules: [AGENTS_RULE] });
    expect(within(ruleList()).getByText(/1 sentence withheld/)).toBeTruthy();

    await goTo("The Sixth Sense");

    expect(within(ruleList()).getByText(/2 sentences withheld/)).toBeTruthy();
  });

  it("still names itself and its reason there, with nothing left for the reader to open", async () => {
    const registered = await openWithAgent("Fight Club (film)");
    await callTool(registered, "add_rules", { rules: [AGENTS_RULE] });

    await goTo("The Sixth Sense");

    const row = within(ruleList()).getByText("How the film came to be made").closest("li") as HTMLElement;
    /* The drawer opened itself when the rule landed and is still open on the article after it. */
    expect((row.closest("details") as HTMLDetailsElement).open).toBe(true);
    expect(row.textContent).toContain("you said you want to watch it cold");
    expect(row.textContent).toContain("2 sentences withheld");
    expect(row.textContent).not.toContain("studio");
  });

  it("keeps its phrases behind the same mask on the new article", async () => {
    const registered = await openWithAgent("Fight Club (film)");
    await callTool(registered, "add_rules", { rules: [AGENTS_RULE] });

    await goTo("The Sixth Sense");

    await userEvent.click(screen.getByRole("button", { name: /may contain spoilers/ }));
    expect(within(ruleList()).getByText("studio")).toBeTruthy();
  });

  it("keeps its place in the record, named with the article it was made on", async () => {
    const registered = await openWithAgent("Fight Club (film)");
    await callTool(registered, "add_rules", { rules: [AGENTS_RULE] });

    await goTo("The Sixth Sense");

    const decisions = screen.getByRole("heading", { name: "Decisions" }).parentElement;
    expect(decisions?.textContent).toContain("you said you want to watch it cold");
    expect(decisions?.textContent).toContain("in Fight Club (film)");
  });
});

/**
 * Every rule reads the same way down the sidebar, whoever made it: what is hidden, why, and how far
 * it reaches. Only the middle line is an agent's to fill, and only the icon says whose rule it is.
 */
/**
 * The drawer is folded away because a reader who has no rules has nothing to read here, and the
 * slider above it is the control they came for. It opens itself the moment a rule lands, because a
 * rule that starts withholding sentences without showing its row is a rule filtering silently.
 */
describe("the Always hide drawer", () => {
  function drawer(): HTMLDetailsElement {
    return screen.getByText(/^Always hide/).closest("details") as HTMLDetailsElement;
  }

  it("is folded away when the page opens", async () => {
    await open("Fight Club (film)");

    expect(drawer().open).toBe(false);
    expect(screen.getByText("Always hide")).toBeTruthy();
  });

  it("opens itself when the reader adds a phrase", async () => {
    await open("Fight Club (film)");

    await add("studio");

    expect(drawer().open).toBe(true);
  });

  it("opens itself when the agent adds a rule", async () => {
    const registered = await openWithAgent("Fight Club (film)");

    await callTool(registered, "add_rules", { rules: [AGENTS_RULE] });

    expect(drawer().open).toBe(true);
  });

  it("counts every rule the reader holds, on whichever article they are reading", async () => {
    await open("Fight Club (film)");
    await add("studio");
    expect(screen.getByText("Always hide · 1")).toBeTruthy();

    await goTo("The Sixth Sense");

    expect(screen.getByText("Always hide · 1")).toBeTruthy();
  });

  it("says nothing where there is nothing to say", async () => {
    await open("Fight Club (film)");

    expect(within(drawer()).queryByText(/Nothing yet/)).toBeNull();
  });

  it("closes again when the reader folds it away", async () => {
    await open("Fight Club (film)");
    await add("studio");

    await userEvent.click(screen.getByText("Always hide · 1"));

    expect(drawer().open).toBe(false);
  });

  /*
   * Folding the drawer away says the reader is done with the rules they have, not that they want to
   * be kept from the next one. A rule starts withholding sentences the moment it lands, so the
   * drawer opens again to show its row, however many times the reader has closed it.
   */
  it("opens again for an agent's rule after the reader has folded it away", async () => {
    const registered = await openWithAgent("Fight Club (film)");
    await callTool(registered, "add_rules", { rules: [AGENTS_RULE] });
    await userEvent.click(screen.getByText("Always hide · 1"));
    expect(drawer().open).toBe(false);

    await callTool(registered, "add_rules", {
      rules: [{ phrases: ["Palahniuk"], label: "Who wrote it", reason: "you asked to meet it cold" }],
    });

    expect(drawer().open).toBe(true);
  });

  it("opens again for the reader's own phrase after they have folded it away", async () => {
    await open("Fight Club (film)");
    await add("studio");
    await userEvent.click(screen.getByText("Always hide · 1"));
    expect(drawer().open).toBe(false);

    await add("Palahniuk");

    expect(drawer().open).toBe(true);
  });

  it("opens again every time, not just the once", async () => {
    const registered = await openWithAgent("Fight Club (film)");

    const rules = [
      { phrases: ["Palahniuk"], label: "Who wrote it", reason: "you asked to meet it cold" },
      { phrases: ["Los Angeles"], label: "Where it was filmed", reason: "you asked to meet it cold" },
      { phrases: ["Fox 2000"], label: "Who paid for it", reason: "you asked to meet it cold" },
    ];
    for (const rule of rules) {
      await callTool(registered, "add_rules", { rules: [rule] });
      expect(drawer().open).toBe(true);
      await userEvent.click(screen.getByText(/^Always hide · /));
      expect(drawer().open).toBe(false);
    }
  });
});

describe("the shape of a rule row", () => {
  const LONG_REASON = {
    ...AGENTS_RULE,
    reason:
      "you told me you are watching this one tonight with someone who has not seen it, and you asked me to keep everything about how it was put together away from you until you have both finished it",
  };

  function rowFor(name: string): HTMLElement {
    return within(ruleList()).getByText(name).closest("li") as HTMLElement;
  }

  it("names the reader's own phrase, and marks it as theirs", async () => {
    await open("Fight Club (film)");

    await add("studio");

    const row = rowFor("studio");
    expect(within(row).getByRole("img", { name: "Added by you" })).toBeTruthy();
    expect(within(row).getByText("1 sentence withheld")).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Stop hiding studio" })).toBeTruthy();
  });

  it("gives the reader's own rule no reason to read and nothing to uncover", async () => {
    await open("Fight Club (film)");

    await add("studio");

    const row = rowFor("studio");
    expect(within(row).queryByRole("button", { name: /may contain spoilers/ })).toBeNull();
    expect(within(row).queryByRole("button", { expanded: false })).toBeNull();
  });

  it("names an agent's rule by its label, and marks it as the agent's", async () => {
    const registered = await openWithAgent("Fight Club (film)");

    await callTool(registered, "add_rules", { rules: [AGENTS_RULE] });

    const row = rowFor("How the film came to be made");
    expect(within(row).getByRole("img", { name: "Added by your agent" })).toBeTruthy();
    expect(within(row).getByText("1 sentence withheld")).toBeTruthy();
    expect(within(row).getByRole("button", { name: /may contain spoilers/ })).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Stop hiding How the film came to be made" })).toBeTruthy();
  });

  it("folds a long reason away until the reader asks for the rest of it", async () => {
    const registered = await openWithAgent("Fight Club (film)");
    await callTool(registered, "add_rules", { rules: [LONG_REASON] });

    const reason = within(rowFor("How the film came to be made")).getByRole("button", {
      name: LONG_REASON.reason,
    });
    expect(reason.getAttribute("aria-expanded")).toBe("false");

    await userEvent.click(reason);

    expect(reason.getAttribute("aria-expanded")).toBe("true");
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

    expect(JSON.parse(stored() ?? "[]")).toMatchObject([{ phrases: ["studio"], origin: "reader" }]);
  });

  it("ignores a stored value it cannot read", async () => {
    window.localStorage.setItem("unspoiled.rules", "{{{");

    await open("Fight Club (film)");

    expect(screen.getByText(PITT)).toBeTruthy();
  });
});
