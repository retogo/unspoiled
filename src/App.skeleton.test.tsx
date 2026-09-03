import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const SIXTH_SENSE = `<div class="mw-parser-output">
  <p>The Sixth Sense is a 1999 American thriller directed by
    <a href="/wiki/M._Night_Shyamalan" title="M. Night Shyamalan">Shyamalan</a>.</p>
</div>`;

const SHYAMALAN = `<div class="mw-parser-output">
  <p>Manoj Nelliyattu Shyamalan is an American filmmaker raised in Pennsylvania.</p>
</div>`;

const fetchArticle = vi.fn();

vi.mock("./lib/wikipedia", () => ({
  fetchArticle: (lang: string, title: string) => fetchArticle(lang, title),
  searchArticles: async () => [],
}));

/** The fetch every test holds open, so the page can be read while an article is still on its way. */
let arrive: (page: unknown) => void = () => {};
let fail: (cause: Error) => void = () => {};

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  fetchArticle.mockReset();
  fetchArticle.mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        arrive = resolve;
        fail = reject;
      }),
  );
});

afterEach(() => {
  cleanup();
});

async function deliver(title: string, html: string): Promise<void> {
  await act(async () => {
    arrive({
      lang: "en",
      title,
      displayTitle: title,
      sourceUrl: `https://en.wikipedia.org/wiki/${title}`,
      html,
    });
  });
}

async function breakDown(message: string): Promise<void> {
  await act(async () => {
    fail(new Error(message));
  });
}

function loadingSaid(): boolean {
  return screen.queryByText("Loading article") !== null;
}

describe("the article the page is still fetching", () => {
  it("stands in the article's place, in the article's shape", () => {
    render(<App />);

    fireEvent.click(screen.getByText("The Sixth Sense"));

    expect(screen.getByRole("article").getAttribute("aria-busy")).toBe("true");
    expect(loadingSaid()).toBe(true);
  });

  it("gives way to the article once it arrives", async () => {
    render(<App />);
    fireEvent.click(screen.getByText("The Sixth Sense"));

    await deliver("The Sixth Sense", SIXTH_SENSE);

    expect(loadingSaid()).toBe(false);
    expect(screen.getByRole("article").getAttribute("aria-busy")).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "The Sixth Sense" })).toBeTruthy();
  });

  it("gives way to what went wrong when the fetch fails", async () => {
    render(<App />);
    fireEvent.click(screen.getByText("The Sixth Sense"));

    await breakDown("Wikipedia API returned 404");

    expect(loadingSaid()).toBe(false);
    expect(screen.getByText("Wikipedia API returned 404")).toBeTruthy();
  });

  it("takes the article already open out of the page, leaving nothing to read on", async () => {
    window.history.replaceState(null, "", "?sensitivity=0");
    render(<App />);
    fireEvent.click(screen.getByText("The Sixth Sense"));
    await deliver("The Sixth Sense", SIXTH_SENSE);

    fireEvent.click(screen.getByRole("link", { name: "Shyamalan" }));

    expect(loadingSaid()).toBe(true);
    expect(screen.queryByRole("heading", { level: 2, name: "The Sixth Sense" })).toBeNull();

    await deliver("M. Night Shyamalan", SHYAMALAN);
    expect(screen.getByRole("heading", { level: 2, name: "M. Night Shyamalan" })).toBeTruthy();
  });
});
