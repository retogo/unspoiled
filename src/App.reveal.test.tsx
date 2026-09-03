import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { flowPieces } from "./lib/flow";

const HTML = `<div class="mw-parser-output">
  <p>The Sixth Sense is a 1999 American supernatural thriller film.</p>
  <h2>Plot</h2>
  <p>Malcolm Crowe is shot by a former patient in his own home. Malcolm meets Cole Sear, a boy who is frightened.</p>
  <p>Malcolm understands that he has been a ghost since the opening scene.</p>
  <h2>Ending explained</h2>
  <p>Shyamalan has said in interviews that the film was written to reward a second viewing.</p>
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

const OPENING = "Malcolm Crowe is shot by a former patient in his own home.";
const SECOND = "Malcolm meets Cole Sear, a boy who is frightened.";
const ENDING = "Malcolm understands that he has been a ghost since the opening scene.";

type RegisteredTool = { name: string; execute: (raw: unknown) => Promise<{ content: { text: string }[] }> };

async function openArticle() {
  const registered: RegisteredTool[] = [];
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    writable: true,
    value: { registerTool: (tool: RegisteredTool) => Promise.resolve(registered.push(tool)) },
  });
  window.history.replaceState(null, "", "?title=The%20Sixth%20Sense&lang=en&sensitivity=75");
  render(<App />);
  await screen.findByRole("heading", { level: 2, name: "The Sixth Sense" });

  return async (name: string, input: Record<string, unknown>) => {
    const tool = registered.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`No such tool: ${name}`);
    await act(async () => {
      await tool.execute(JSON.stringify(input));
    });
  };
}

function articleText(): string {
  return screen.getByRole("article").textContent ?? "";
}

function flowing(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".unspoiled-flow")];
}

function flowDelays(): number[] {
  return flowing().map((piece) => Number.parseInt(piece.style.animationDelay, 10));
}

function isAscending(delays: number[]): boolean {
  return delays.every((delay, index) => index === 0 || delay > delays[index - 1]);
}

async function revealParagraph(which: number) {
  await userEvent.click(screen.getByRole("button", { name: new RegExp(`Paragraph ${which}`) }));
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, "modelContext");
});

describe("a sentence the reader has just opened", () => {
  it("arrives a word at a time, from the front of the sentence", async () => {
    await openArticle();

    await revealParagraph(2);

    expect(flowing().map((piece) => piece.textContent).join("")).toBe(ENDING);
    expect(flowDelays().length).toBeGreaterThan(1);
    expect(isAscending(flowDelays())).toBe(true);
  });

  it("starts while the sentence before it in the paragraph is still arriving", async () => {
    await openArticle();

    await revealParagraph(1);

    const delays = flowDelays();
    const second = flowPieces(OPENING, "en").length;
    expect(delays[0]).toBe(0);
    expect(delays[second]).toBeGreaterThan(0);
    expect(delays[second]).toBeLessThan(delays[second - 1]);
  });

  it("arrives the same way when the agent opens it", async () => {
    const call = await openArticle();

    await call("reveal_withheld_sentences", { sentence_ids: ["p2.0"] });

    expect(flowing().map((piece) => piece.textContent).join("")).toBe(ENDING);
  });

  it("still reads as one sentence, spaces and punctuation and all", async () => {
    await openArticle();

    await revealParagraph(1);

    expect(articleText()).toContain(OPENING);
    expect(articleText()).toContain(SECOND);
  });
});

describe("a sentence the sensitivity slider has opened", () => {
  it("is not split into words, because the slider can open hundreds at once", async () => {
    await openArticle();

    fireEvent.change(screen.getByRole("slider"), { target: { value: "30" } });

    expect(articleText()).toContain(OPENING);
    expect(flowing()).toHaveLength(0);
  });
});

describe("hiding an opened sentence again", () => {
  it("takes the sentence back out of the page and puts its placeholder back", async () => {
    await openArticle();
    await revealParagraph(2);

    await userEvent.click(screen.getByRole("button", { name: "Hide this sentence again" }));

    expect(document.body.textContent).not.toContain("been a ghost since the opening scene");
    expect(screen.getByRole("button", { name: /Paragraph 2/ })).toBeTruthy();
  });

  it("offers one control for the sentences a paragraph opened together", async () => {
    await openArticle();
    await revealParagraph(1);

    await userEvent.click(screen.getByRole("button", { name: "Hide 2 sentences again" }));

    expect(document.body.textContent).not.toContain("shot by a former patient");
    expect(document.body.textContent).not.toContain("Cole Sear");
  });

  it("takes back a heading the reader opened", async () => {
    await openArticle();
    await userEvent.click(screen.getByRole("button", { name: "Heading withheld · reveal" }));
    expect(document.body.textContent).toContain("Ending explained");

    await userEvent.click(screen.getByRole("button", { name: "Hide this heading again" }));

    expect(document.body.textContent).not.toContain("Ending explained");
  });

  it("lets the sentence flow in again when the reader opens it a second time", async () => {
    await openArticle();
    await revealParagraph(2);
    await userEvent.click(screen.getByRole("button", { name: "Hide this sentence again" }));

    await revealParagraph(2);

    await waitFor(() => expect(flowing().length).toBeGreaterThan(1));
    expect(flowDelays()[0]).toBe(0);
  });

  it("is offered only for what the reader opened, not for what the slider shows", async () => {
    await openArticle();

    fireEvent.change(screen.getByRole("slider"), { target: { value: "30" } });

    expect(articleText()).toContain(OPENING);
    expect(screen.queryByRole("button", { name: "Hide this sentence again" })).toBeNull();
  });
});
