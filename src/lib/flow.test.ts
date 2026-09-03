import { describe, expect, it } from "vitest";
import { flowDelay, flowPieces } from "./flow";

describe("splitting a sentence into the pieces that arrive", () => {
  it("keeps every character of the sentence", () => {
    const text = "Malcolm Crowe is shot by a former patient, twice.";

    expect(flowPieces(text, "en").join("")).toBe(text);
  });

  it("carries the space and the punctuation with the word before them", () => {
    expect(flowPieces("Malcolm Crowe is shot, twice.", "en")).toEqual([
      "Malcolm ",
      "Crowe ",
      "is ",
      "shot, ",
      "twice.",
    ]);
  });

  it("splits Japanese, which has no spaces to split on", () => {
    const text = "小児精神科医のマルコム・クロウは、幽霊が見える少年と出会う。";
    const pieces = flowPieces(text, "ja");

    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.join("")).toBe(text);
  });
});

describe("when each piece of an opened sentence arrives", () => {
  it("starts the first piece of the first sentence immediately", () => {
    expect(flowDelay(0, 8, 0)).toBe(0);
  });

  it("runs from the front of the sentence to its end", () => {
    const delays = [0, 1, 2, 3].map((index) => flowDelay(index, 4, 0));

    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(new Set(delays).size).toBe(delays.length);
  });

  it("holds a long sentence to the arrival time of a much shorter one", () => {
    expect(flowDelay(59, 60, 0)).toBe(flowDelay(19, 20, 0));
  });

  it("starts each sentence of one reveal after the sentence before it", () => {
    expect(flowDelay(0, 8, 1)).toBeGreaterThan(flowDelay(0, 8, 0));
  });

  it("stops pushing back the start once a reveal opens many sentences", () => {
    expect(flowDelay(0, 8, 40)).toBe(flowDelay(0, 8, 6));
  });
});
