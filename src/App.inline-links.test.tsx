import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const SIXTH_SENSE = `<div class="mw-parser-output">
  <p>The Sixth Sense is a 1999 American thriller written by
    <a href="/wiki/M._Night_Shyamalan" title="M. Night Shyamalan">Shyamalan</a><sup class="reference"><a
    href="#cite_note-mojo-1"><span class="cite-bracket">[</span>1<span class="cite-bracket">]</span></a></sup>
    and reviewed by <a rel="nofollow" class="external text" href="https://example.org/review">a critic</a> that autumn.</p>
  <h2>Plot</h2>
  <p>Malcolm Crowe is shot by a former patient in his own home. Malcolm meets
    <a href="/wiki/Cole_Sear" title="Cole Sear">Cole Sear</a>, a boy who is frightened of the dark.</p>
  <h2>References</h2>
  <div class="reflist"><ol class="references">
    <li id="cite_note-mojo-1"><span class="mw-cite-backlink">^ <a href="#cite_ref-mojo_1-0"><sup>a</sup></a></span>
      <span class="reference-text">Fritz, Ben. <a rel="nofollow" class="external text"
      href="https://example.org/mojo">"The Sixth Sense"</a>. 1999.</span></li>
  </ol></div>
</div>`;

const SHYAMALAN = `<div class="mw-parser-output">
  <p>Manoj Nelliyattu Shyamalan is an American filmmaker who was born in Mahé and raised in Pennsylvania.</p>
</div>`;

const fetchArticle = vi.fn();

vi.mock("./lib/wikipedia", () => ({
  fetchArticle: (lang: string, title: string) => fetchArticle(lang, title),
  searchArticles: async () => [],
}));

function article(title: string, html: string) {
  return {
    lang: "en",
    title,
    displayTitle: title,
    sourceUrl: `https://en.wikipedia.org/wiki/${title}`,
    html,
  };
}

type RegisteredTool = { name: string };

async function openArticle() {
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    writable: true,
    value: { registerTool: (tool: RegisteredTool) => Promise.resolve(tool) },
  });
  window.history.replaceState(null, "", "?title=The%20Sixth%20Sense&lang=en&sensitivity=75");
  render(<App />);
  await screen.findByRole("heading", { level: 2, name: "The Sixth Sense" });
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  fetchArticle.mockReset();
  fetchArticle.mockImplementation(async (_lang: string, title: string) =>
    title === "The Sixth Sense" ? article(title, SIXTH_SENSE) : article(title, SHYAMALAN),
  );
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, "modelContext");
});

describe("a link inside the article text", () => {
  it("opens the linked article in the reader rather than on Wikipedia", async () => {
    await openArticle();

    const link = screen.getByRole("link", { name: "Shyamalan" });
    expect(link.getAttribute("href")).toBe("?lang=en&title=M.+Night+Shyamalan");

    await userEvent.click(link);

    await waitFor(() => expect(fetchArticle).toHaveBeenCalledWith("en", "M. Night Shyamalan"));
    await screen.findByRole("heading", { level: 2, name: "M. Night Shyamalan" });
  });

  it("sends a link off the site to a new tab", async () => {
    await openArticle();

    const link = screen.getByRole("link", { name: /a critic/ });
    expect(link.getAttribute("href")).toBe("https://example.org/review");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
});

describe("a citation marker", () => {
  it("points at the entry it cites, which the page renders under that id", async () => {
    await openArticle();

    expect(screen.getByRole("link", { name: "[1]" }).getAttribute("href")).toBe("#cite_note-mojo-1");
    const entry = document.getElementById("cite_note-mojo-1");
    expect(entry?.textContent).toContain("Fritz, Ben.");
    expect(entry?.textContent).not.toContain("^");
  });

  it("keeps the links of a citation pointing off the site", async () => {
    await openArticle();

    const entry = document.getElementById("cite_note-mojo-1");
    expect(entry?.querySelector("a")?.getAttribute("href")).toBe("https://example.org/mojo");
  });
});

describe("a sentence the reader opens", () => {
  it("keeps its links, and its words still arrive in order across them", async () => {
    await openArticle();

    await userEvent.click(screen.getAllByRole("button", { name: /^Reveal .* chars$/ })[0]);

    const opened = await waitFor(() =>
      screen.getByRole("article").querySelector<HTMLAnchorElement>('a[href="?lang=en&title=Cole+Sear"]'),
    );
    expect(opened?.textContent).toBe("Cole Sear");

    const sentence = opened?.closest('[title="Hide this sentence again"]');
    const pieces = [...(sentence?.querySelectorAll<HTMLElement>(".unspoiled-flow") ?? [])];
    expect(pieces.map((piece) => piece.textContent).join("")).toBe(
      "Malcolm meets Cole Sear, a boy who is frightened of the dark.",
    );
    const delays = pieces.map((piece) => Number.parseInt(piece.style.animationDelay, 10));
    expect(delays).toEqual([...delays].sort((left, right) => left - right));
    expect(new Set(delays).size).toBe(delays.length);
  });
});
