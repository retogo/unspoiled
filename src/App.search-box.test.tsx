import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "./App";
import { SUGGEST_DEBOUNCE_MS } from "./lib/suggest";
import { fetchArticle, searchArticles, type SearchHit } from "./lib/wikipedia";

vi.mock("./lib/wikipedia", () => ({
  searchArticles: vi.fn(),
  fetchArticle: vi.fn(),
}));

/** An article that never arrives, so a test can watch the box ask for one without segmenting it. */
const pending = () => new Promise<never>(() => {});

function suggest(...titles: string[]): SearchHit[] {
  return titles.map((title) => ({ title, snippet: "" }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(searchArticles).mockReset().mockResolvedValue([]);
  vi.mocked(fetchArticle).mockReset().mockImplementation(pending);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function searchBox(): HTMLInputElement {
  return screen.getByPlaceholderText("Search Wikipedia for a film, series or novel");
}

function options(): HTMLElement[] {
  return screen.queryAllByRole("option");
}

/** Typing, then letting the debounce and the response the box was waiting on through. */
async function typeAndSettle(input: HTMLElement, value: string): Promise<void> {
  fireEvent.change(input, { target: { value } });
  await act(async () => {
    vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS);
  });
}

describe("the search box", () => {
  it("does not search while an IME conversion is still open", async () => {
    render(<App />);
    const input = searchBox();

    fireEvent.compositionStart(input);
    await typeAndSettle(input, "しっくすせんす");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });

    expect(searchArticles).not.toHaveBeenCalled();
  });

  it("searches once the conversion is committed", async () => {
    render(<App />);
    const input = searchBox();

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "シックス・センス" } });
    fireEvent.compositionEnd(input);
    await act(async () => {
      vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS);
    });

    expect(searchArticles).toHaveBeenCalledWith("en", "シックス・センス");
  });

  it("leaves a single character alone", async () => {
    render(<App />);

    await typeAndSettle(searchBox(), "s");

    expect(searchArticles).not.toHaveBeenCalled();
  });

  it("waits for the reader to stop typing", async () => {
    render(<App />);
    const input = searchBox();

    fireEvent.change(input, { target: { value: "sixth" } });
    await act(async () => {
      vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS - 1);
    });
    expect(searchArticles).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(searchArticles).toHaveBeenCalledTimes(1);
  });

  it("keeps the answer to the question it is still asking", async () => {
    const answers = new Map<string, (hits: SearchHit[]) => void>();
    vi.mocked(searchArticles).mockImplementation(
      (_lang, term) => new Promise((resolve) => answers.set(term, resolve)),
    );
    render(<App />);
    const input = searchBox();

    await typeAndSettle(input, "six");
    await typeAndSettle(input, "sixth");

    await act(async () => answers.get("sixth")?.(suggest("The Sixth Sense")));
    await act(async () => answers.get("six")?.(suggest("Six Feet Under")));

    expect(options().map((option) => option.textContent)).toEqual(["The Sixth Sense"]);
  });

  it("opens the first suggestion on Enter", async () => {
    vi.mocked(searchArticles).mockResolvedValue(suggest("The Sixth Sense", "Sixth sense"));
    render(<App />);
    const input = searchBox();

    await typeAndSettle(input, "sixth");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(fetchArticle).toHaveBeenCalledWith("en", "The Sixth Sense");
  });

  it("searches on Enter before the suggestions have arrived", () => {
    render(<App />);
    const input = searchBox();

    fireEvent.change(input, { target: { value: "シックス・センス" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(searchArticles).toHaveBeenCalledWith("en", "シックス・センス");
  });

  it("moves the highlight with the arrow keys", async () => {
    vi.mocked(searchArticles).mockResolvedValue(suggest("The Sixth Sense", "Sixth sense"));
    render(<App />);
    const input = searchBox();

    await typeAndSettle(input, "sixth");
    expect(input.getAttribute("aria-activedescendant")).toBe(options()[0].id);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options()[1].id);
    expect(options()[1].getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toBe(options()[0].id);

    fireEvent.keyDown(input, { key: "Enter" });
    expect(fetchArticle).toHaveBeenCalledWith("en", "The Sixth Sense");
  });

  it("closes the suggestions on Escape", async () => {
    vi.mocked(searchArticles).mockResolvedValue(suggest("The Sixth Sense"));
    render(<App />);
    const input = searchBox();

    await typeAndSettle(input, "sixth");
    expect(options()).toHaveLength(1);

    fireEvent.keyDown(input, { key: "Escape" });
    expect(options()).toHaveLength(0);
  });

  it("searches again in the language the reader switches to", async () => {
    render(<App />);
    const input = searchBox();

    await typeAndSettle(input, "sixth");
    fireEvent.click(screen.getByRole("button", { name: "JA" }));
    await act(async () => {
      vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS);
    });

    expect(searchArticles).toHaveBeenLastCalledWith("ja", "sixth");
  });

  it("opens the article a suggestion names and closes the list", async () => {
    vi.mocked(searchArticles).mockResolvedValue(suggest("The Sixth Sense", "Sixth sense"));
    render(<App />);

    await typeAndSettle(searchBox(), "sixth");
    fireEvent.click(options()[1]);

    expect(fetchArticle).toHaveBeenCalledWith("en", "Sixth sense");
    expect(options()).toHaveLength(0);
  });

  it("has no language menu and no search button to press", () => {
    render(<App />);

    expect(document.querySelector("select")).toBeNull();
    expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
  });
});
