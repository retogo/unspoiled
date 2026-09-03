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

afterEach(cleanup);

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
