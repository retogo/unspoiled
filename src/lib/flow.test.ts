import { describe, expect, it } from "vitest";
import { FLOW_PIECE_MS, flowDelay, flowPieces, flowStarts } from "./flow";

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
  const BATCH_MS = 2800;

  /** How long a sentence of `count` words spends arriving, and when its last word has resolved. */
  const spread = (count: number) => flowDelay(count - 1, count, 0);
  const arrived = (start: number, count: number) => start + spread(count) + FLOW_PIECE_MS;

  it("opens a single sentence with no wait at all", () => {
    expect(flowStarts([9])).toEqual([0]);
  });

  it("follows a short sentence closely rather than waiting out a length it never used", () => {
    const [first, second] = flowStarts([3, 3, 3]);

    expect(first).toBe(0);
    expect(second).toBeLessThan(spread(3) + FLOW_PIECE_MS);
  });

  it("waits longer after a long sentence than after a short one, by exactly its extra spread", () => {
    const afterLong = flowStarts([20, 5])[1];
    const afterShort = flowStarts([4, 5])[1];

    expect(afterLong - afterShort).toBe(spread(20) - spread(4));
  });

  it("times a sentence by the one before it, never by its own length", () => {
    expect(flowStarts([6, 3])[1]).toBe(flowStarts([6, 30])[1]);
  });

  it("runs forward, each step as long as the sentence it waits for", () => {
    const [first, second, third] = flowStarts([3, 12, 3]);

    expect(second - first).toBeLessThan(third - second);
  });

  it("keeps the whole reveal inside the time a reader will wait", () => {
    for (const opened of [2, 5, 12, 30]) {
      const counts = Array.from({ length: opened }, (_, index) => 6 + (index % 7) * 3);
      const starts = flowStarts(counts);

      expect(arrived(starts[opened - 1], counts[opened - 1])).toBeLessThanOrEqual(BATCH_MS);
      expect(starts[opened - 1]).toBeLessThanOrEqual(BATCH_MS - spread(counts[opened - 1]));
    }
  });

  /** Whole milliseconds are all a delay can carry, so the pacing is kept to within a few percent. */
  it("keeps the long and short of a reveal in proportion when it has to tighten", () => {
    const alternating = (opened: number) =>
      Array.from({ length: opened }, (_, index) => (index % 2 === 0 ? 4 : 20));
    const paced = (starts: number[]) => (starts[2] - starts[1]) / (starts[1] - starts[0]);

    expect(paced(flowStarts(alternating(20)))).toBeCloseTo(paced(flowStarts(alternating(3))), 1);
  });
});
