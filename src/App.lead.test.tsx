import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const HTML = `<div class="mw-parser-output">
  <p>The Sixth Sense is a 1999 American supernatural thriller film directed by M. Night Shyamalan. The twist ending reveals that Malcolm has been dead since the opening scene.</p>
  <h2>Plot</h2>
  <p>Malcolm Crowe is shot by a former patient in his own home one winter night.</p>
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

async function openArticle(sensitivity: number) {
  window.history.replaceState(null, "", `?title=The%20Sixth%20Sense&lang=en&sensitivity=${sensitivity}`);
  render(<App />);
  await screen.findByRole("heading", { level: 2, name: "The Sixth Sense" });
}

/** The lead stands first in the article, whether or not anything is drawn above its text. */
function lead(): HTMLElement {
  return screen.getByRole("article").querySelector("section") as HTMLElement;
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(cleanup);

describe("the lead section of an article", () => {
  it("carries no heading of its own, because the article does not give it one", async () => {
    await openArticle(75);

    expect(within(lead()).queryAllByRole("heading")).toEqual([]);
    expect(screen.queryByRole("heading", { name: /Lead section/ })).toBeNull();
  });

  it("still says how much of it is withheld, on a line of its own above the text", async () => {
    await openArticle(75);

    expect(within(lead()).getByText("1 withheld")).toBeTruthy();
    expect(lead().firstElementChild?.tagName).toBe("DIV");
  });

  it("draws nothing above the text when the whole lead is on screen", async () => {
    await openArticle(0);

    expect(within(lead()).queryByText(/withheld/)).toBeNull();
    expect(lead().firstElementChild?.tagName).toBe("P");
  });
});
