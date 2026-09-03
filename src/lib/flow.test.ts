import { describe, expect, it } from "vitest";
import { FLOW_PIECE_MS, flowDelay, flowPieces, flowStart } from "./flow";

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
  const LONGEST = 40;

  it("starts the first piece of the first sentence immediately", () => {
    expect(flowDelay(0, 8, 0)).toBe(0);
  });

  it("runs from the front of the sentence to its end", () => {
    const delays = [0, 1, 2, 3].map((index) => flowDelay(index, 4, 0));

    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(new Set(delays).size).toBe(delays.length);
  });

  it("holds a long sentence to the arrival time of a much shorter one", () => {
    expect(flowDelay(LONGEST - 1, LONGEST, 0)).toBe(flowDelay(19, 20, 0));
  });

  it("offsets every piece by the time the sentence itself begins", () => {
    expect(flowDelay(3, 8, 500)).toBe(flowDelay(3, 8, 0) + 500);
  });
});

describe("when each sentence of one reveal begins", () => {
  const LONGEST = 40;

  /** The moment the last word of a sentence that began at `start` has finished arriving. */
  function arrived(start: number): number {
    return flowDelay(LONGEST - 1, LONGEST, start) + FLOW_PIECE_MS;
  }

  it("starts the first sentence immediately", () => {
    expect(flowStart(0, 3)).toBe(0);
  });

  it("waits for the sentence before it to have finished arriving", () => {
    expect(flowStart(1, 3)).toBeGreaterThanOrEqual(arrived(flowStart(0, 3)));
    expect(flowStart(2, 3)).toBeGreaterThanOrEqual(arrived(flowStart(1, 3)));
  });

  it("opens a single sentence with no wait at all", () => {
    expect(flowStart(0, 1)).toBe(0);
  });

  it("keeps a reveal of many sentences inside the time a reader will wait", () => {
    for (const opened of [2, 4, 8, 20]) {
      expect(arrived(flowStart(opened - 1, opened))).toBeLessThanOrEqual(2800);
    }
  });

  it("tightens the gap once a reveal opens more sentences than fit one after another", () => {
    expect(flowStart(1, 20)).toBeLessThan(flowStart(1, 3));
  });
});
