import { describe, expect, it } from "vitest";
import { FLOW_PIECE_MS, flowDelay, flowPieces, flowTimings } from "./flow";

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

describe("when each word of an opened sentence arrives", () => {
  const [only] = flowTimings([8]);

  it("starts the first word of the reveal immediately", () => {
    expect(flowDelay(0, only)).toBe(0);
  });

  it("runs from the front of the sentence to its end", () => {
    const delays = [0, 1, 2, 3].map((index) => flowDelay(index, only));

    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(new Set(delays).size).toBe(delays.length);
  });

  it("holds one steady step from word to word", () => {
    expect(flowDelay(3, only) - flowDelay(2, only)).toBe(flowDelay(1, only) - flowDelay(0, only));
  });
});

describe("when each sentence of one reveal begins", () => {
  const BATCH_MS = 2800;

  it("opens a single sentence with no wait at all", () => {
    expect(flowTimings([9])[0].start).toBe(0);
  });

  it("carries straight on from the last word of the sentence before it", () => {
    const [first, second] = flowTimings([5, 7]);

    expect(second.start).toBe(flowDelay(5, first));
  });

  it("keeps counting words across the whole reveal, never pausing at a full stop", () => {
    const timings = flowTimings([5, 7, 3]);

    expect(timings[1].start).toBe(flowDelay(5, timings[0]));
    expect(timings[2].start).toBe(flowDelay(12, timings[0]));
  });

  it("moves every sentence of one reveal at the same pace", () => {
    expect(new Set(flowTimings([5, 30, 2]).map((timing) => timing.step)).size).toBe(1);
  });

  it("runs at full pace when the reveal is short enough to afford it", () => {
    const [first, second] = flowTimings([5, 7]);

    expect(second.start - first.start).toBe(flowDelay(5, first));
    expect(first.step).toBe(20);
  });

  it("tightens the step so even a long reveal lands inside the time a reader will wait", () => {
    const counts = Array.from({ length: 20 }, () => 25);
    const timings = flowTimings(counts);
    const last = timings[timings.length - 1];

    expect(last.step).toBeLessThan(20);
    expect(flowDelay(24, last) + FLOW_PIECE_MS).toBeLessThanOrEqual(BATCH_MS);
  });
});
