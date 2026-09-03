import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { flowPieces, flowStarts } from "./lib/flow";

const HTML = `<div class="mw-parser-output">
  <p>The Sixth Sense is a 1999 American supernatural thriller film.</p>
  <h2>Plot</h2>
  <p>Malcolm Crowe is shot by a former patient in his own home. Malcolm meets Cole Sear, a boy who is frightened.</p>
  <p>Malcolm understands that he has been a ghost since the opening scene.</p>
  <h2>Ending explained</h2>
  <p>Shyamalan has said in interviews that the film was written to reward a second viewing.</p>
  <h2>Ending: the twist</h2>
  <p>Malcolm realises the truth about himself in the final minutes of the film.</p>
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

/** The sentences of the article the reader has opened. Each is itself the control that closes it. */
function openedSentences(): HTMLElement[] {
  return screen.queryAllByTitle("Hide this sentence again");
}

function delaysWithin(sentence: HTMLElement): string[] {
  return [...sentence.querySelectorAll<HTMLElement>(".unspoiled-flow")].map((piece) => piece.style.animationDelay);
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
  await userEvent.click(screen.getAllByRole("button", { name: /^Reveal .* chars$/ })[which - 1]);
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
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

  it("waits for the sentence before it in the paragraph to finish arriving", async () => {
    await openArticle();

    await revealParagraph(1);

    const delays = flowDelays();
    const counts = [OPENING, SECOND].map((text) => flowPieces(text, "en").length);
    const second = counts[0];
    expect(delays[0]).toBe(0);
    expect(delays[second]).toBe(flowStarts(counts)[1]);
    expect(isAscending(delays)).toBe(true);
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

    await userEvent.click(openedSentences()[0]);

    expect(document.body.textContent).not.toContain("been a ghost since the opening scene");
    expect(screen.getByRole("button", { name: `Reveal 1 sentence withheld, ${ENDING.length} chars` })).toBeTruthy();
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
    await userEvent.click(screen.getAllByRole("button", { name: "Heading withheld · reveal" })[0]);
    expect(document.body.textContent).toContain("Ending explained");

    await userEvent.click(screen.getByTitle("Hide this heading again"));

    expect(document.body.textContent).not.toContain("Ending explained");
  });

  it("lets the sentence flow in again when the reader opens it a second time", async () => {
    await openArticle();
    await revealParagraph(2);
    await userEvent.click(openedSentences()[0]);

    await revealParagraph(2);

    await waitFor(() => expect(flowing().length).toBeGreaterThan(1));
    expect(flowDelays()[0]).toBe(0);
  });

  it("leaves a sentence that stays open exactly as it was, with no second arrival", async () => {
    await openArticle();
    await revealParagraph(1);
    const opened = openedSentences();
    expect(opened).toHaveLength(2);
    const staying = opened[1];
    const delays = delaysWithin(staying);

    await userEvent.click(opened[0]);

    expect(openedSentences()).toEqual([staying]);
    expect(delaysWithin(staying)).toEqual(delays);
  });

  it("leaves the sentences open in another paragraph untouched", async () => {
    await openArticle();
    await revealParagraph(1);
    await userEvent.click(screen.getByRole("button", { name: "1 sentence withheld · reveal" }));
    const elsewhere = openedSentences()[2];

    await userEvent.click(openedSentences()[0]);

    expect(openedSentences()).toContain(elsewhere);
  });

  it("leaves the placeholders already on the page where they are", async () => {
    await openArticle();
    await revealParagraph(1);
    const standing = screen.getByRole("button", { name: "1 sentence withheld · reveal" });

    await userEvent.click(openedSentences()[0]);

    const chips = screen.getAllByRole("button", { name: "1 sentence withheld · reveal" });
    expect(chips).toHaveLength(2);
    expect(chips).toContain(standing);
  });

  it("leaves the sentences of a section alone when its heading is taken back", async () => {
    await openArticle();
    await revealParagraph(3);
    await userEvent.click(screen.getAllByRole("button", { name: "Heading withheld · reveal" })[1]);
    const sentence = openedSentences()[0];
    const delays = delaysWithin(sentence);

    await userEvent.click(screen.getByTitle("Hide this heading again"));

    expect(openedSentences()).toEqual([sentence]);
    expect(delaysWithin(sentence)).toEqual(delays);
  });

  it("is offered only for what the reader opened, not for what the slider shows", async () => {
    await openArticle();

    fireEvent.change(screen.getByRole("slider"), { target: { value: "30" } });

    expect(articleText()).toContain(OPENING);
    expect(openedSentences()).toHaveLength(0);
  });
});

describe("closing an opened sentence with one tap on the sentence itself", () => {
  it("costs no aim: the whole sentence is the control, and there is no small button to find", async () => {
    await openArticle();
    await revealParagraph(2);

    expect(openedSentences()[0].textContent).toContain(ENDING);
    expect(screen.queryByText("×")).toBeNull();
  });

  it("still reads the sentence out to anyone listening, rather than the name of the control", async () => {
    await openArticle();
    await revealParagraph(2);

    expect(screen.getByRole("button", { name: ENDING })).toBe(openedSentences()[0]);
  });

  it("closes on Enter, for a reader who is not using a pointer", async () => {
    await openArticle();
    await revealParagraph(2);

    openedSentences()[0].focus();
    await userEvent.keyboard("{Enter}");

    expect(document.body.textContent).not.toContain("been a ghost since the opening scene");
  });

  it("closes on Space as well", async () => {
    await openArticle();
    await revealParagraph(2);

    openedSentences()[0].focus();
    await userEvent.keyboard(" ");

    expect(document.body.textContent).not.toContain("been a ghost since the opening scene");
  });

  it("leaves the sentence open when the reader was selecting text in it", async () => {
    await openArticle();
    await revealParagraph(2);
    const sentence = openedSentences()[0];
    window.getSelection()?.selectAllChildren(sentence.querySelectorAll(".unspoiled-flow")[1]);

    fireEvent.click(sentence);

    expect(articleText()).toContain(ENDING);
  });

  it("lets a link inside the sentence be followed instead of closing it", async () => {
    await openArticle();
    await revealParagraph(2);
    const sentence = openedSentences()[0];
    const link = document.createElement("a");
    link.href = "#cole";
    link.textContent = "Cole Sear";
    sentence.append(link);

    fireEvent.click(link, { bubbles: true });

    expect(articleText()).toContain(ENDING);
  });
});
