import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { maskRows } from "./lib/mask";

const ONE_LINE = "Malcolm Crowe is shot by a former patient in his own home.";
const THREE_LINES = [
  "Malcolm meets Cole Sear, a frightened boy who tells him that he sees dead people walking around like ordinary people.",
  "Cole takes Malcolm's advice and listens to the ghosts who come to him, and helps a poisoned girl expose her mother.",
  "Malcolm goes home, sees his wedding ring on his wife's hand, and understands that he has been dead since the opening scene.",
];

const HTML = `<div class="mw-parser-output">
  <p>The Sixth Sense is a 1999 American supernatural thriller film written and directed by M. Night Shyamalan.</p>
  <h2>Plot</h2>
  <p>${ONE_LINE}</p>
  <p>${THREE_LINES.join(" ")}</p>
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

async function openArticle() {
  window.history.replaceState(null, "", "?title=The%20Sixth%20Sense&lang=en&sensitivity=75");
  render(<App />);
  await screen.findByRole("heading", { level: 2, name: "The Sixth Sense" });
}

function placeholders(): HTMLElement[] {
  return screen.getAllByText(/chars · reveal$/);
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(cleanup);

describe("the placeholder standing in for a withheld paragraph", () => {
  it("says what it holds and how to open it, in the words a withheld sentence uses", async () => {
    await openArticle();

    expect(placeholders().map((mask) => mask.textContent)).toEqual([
      `1 sentence withheld · ${ONE_LINE.length} chars · reveal`,
      `3 sentences withheld · ${THREE_LINES.join("").length} chars · reveal`,
    ]);
  });

  it("does not number the paragraphs, which is page furniture and not withheld text", async () => {
    await openArticle();

    expect(screen.getByRole("article").textContent).not.toContain("Paragraph");
  });

  it("stands as tall as the text it withholds, so the band shows how much is behind it", async () => {
    await openArticle();

    expect(placeholders().map((mask) => mask.style.minHeight)).toEqual([
      `${maskRows(ONE_LINE.length, "en") * 1.75}rem`,
      `${maskRows(THREE_LINES.join("").length, "en") * 1.75}rem`,
    ]);
  });

  it("is filled like a withheld sentence rather than outlined like a drop target", async () => {
    await openArticle();

    for (const mask of placeholders()) {
      expect(mask.className).toContain("bg-mask");
      expect(mask.className).not.toContain("border");
    }
  });

  it("tells a screen reader how many sentences and characters it would open", async () => {
    await openArticle();

    expect(placeholders().map((mask) => mask.getAttribute("aria-label"))).toEqual([
      `Reveal 1 sentence withheld, ${ONE_LINE.length} chars`,
      `Reveal 3 sentences withheld, ${THREE_LINES.join("").length} chars`,
    ]);
  });
});
