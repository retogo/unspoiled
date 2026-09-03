import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const HTML = `<div class="mw-parser-output">
  <p>The Sixth Sense is a 1999 American supernatural thriller film.</p>
  <h2>Plot</h2>
  <p>Malcolm Crowe is shot by a former patient in his own home. Malcolm meets Cole Sear, a boy who is frightened.</p>
  <p>Malcolm understands that he has been a ghost since the opening scene.</p>
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

const VIEWPORT = 800;

const scrollBy = vi.fn();

async function openArticle() {
  window.history.replaceState(null, "", "?title=The%20Sixth%20Sense&lang=en&sensitivity=75");
  render(<App />);
  await screen.findByRole("heading", { level: 2, name: "The Sixth Sense" });
}

async function revealParagraph() {
  await userEvent.click(screen.getAllByRole("button", { name: /^Reveal .* chars$/ })[0]);
}

function words(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".unspoiled-flow")];
}

/** jsdom lays nothing out, so each word is told where it sits and then told it has begun to arrive. */
function arrives(word: HTMLElement, bottom: number) {
  word.getBoundingClientRect = () => ({ top: bottom - 24, bottom, height: 24 }) as DOMRect;
  fireEvent(word, new Event("animationstart", { bubbles: true }));
}

/** The policy bar is pinned across the foot of the window on a narrow screen. */
function pinPolicyBarAcrossFoot(height: number) {
  const panel = document.getElementById("sensitivity")?.closest("div");
  if (panel) {
    panel.getBoundingClientRect = () =>
      ({ top: VIEWPORT - height, bottom: VIEWPORT, height }) as DOMRect;
  }
}

beforeEach(() => {
  scrollBy.mockClear();
  window.scrollBy = scrollBy;
  window.innerHeight = VIEWPORT;
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(cleanup);

describe("the page following the words a reveal is opening", () => {
  it("moves down when a word starts arriving below the foot of the window", async () => {
    await openArticle();
    await revealParagraph();

    arrives(words()[0], 700);

    expect(scrollBy).toHaveBeenCalledWith({ top: 20, behavior: "smooth" });
  });

  it("stays where it is while the words are still well up the screen", async () => {
    await openArticle();
    await revealParagraph();

    arrives(words()[0], 300);

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("makes room for the policy bar pinned across the foot of a narrow screen", async () => {
    await openArticle();
    await revealParagraph();
    pinPolicyBarAcrossFoot(66);

    arrives(words()[0], 700);

    expect(scrollBy).toHaveBeenCalledWith({ top: 86, behavior: "smooth" });
  });

  it("hands the page back the moment the reader scrolls it themselves", async () => {
    await openArticle();
    await revealParagraph();

    fireEvent.wheel(window);
    arrives(words()[0], 700);

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("hands the page back when the reader scrolls it from the keyboard", async () => {
    await openArticle();
    await revealParagraph();

    fireEvent.keyDown(window, { key: "PageDown" });
    arrives(words()[0], 700);

    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("follows the next reveal even after the reader took the page back from the last one", async () => {
    await openArticle();
    await revealParagraph();
    fireEvent.wheel(window);

    await userEvent.click(screen.getByRole("button", { name: /^Reveal 1 sentence withheld/ }));
    arrives(words().at(-1) as HTMLElement, 700);

    expect(scrollBy).toHaveBeenCalledWith({ top: 20, behavior: "smooth" });
  });

  it("leaves the page alone for the sentences the slider opens", async () => {
    await openArticle();

    fireEvent.change(screen.getByRole("slider"), { target: { value: "30" } });
    const shown = document.querySelector<HTMLElement>(".unspoiled-text");
    if (shown) arrives(shown, 700);

    expect(scrollBy).not.toHaveBeenCalled();
  });
});
