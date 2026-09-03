import type { Run } from "./segment";
import type { Lang } from "./wikipedia";

/**
 * What one reveal opens arrives as a single stream of words, from the front. Neighbouring words are
 * `PIECE_STEP_MS` apart wherever they fall, so the first word of a sentence follows the last word of
 * the one before it at exactly that step and nothing pauses at a full stop. Each word then takes
 * `FLOW_PIECE_MS` to resolve — the duration `.unspoiled-flow` carries in `index.css`. Only when a
 * reveal opens so many words that the stream would outlast `BATCH_MS` does the step tighten, and it
 * tightens for every word of that reveal alike.
 */
const PIECE_STEP_MS = 20;
const BATCH_MS = 2800;

export const FLOW_PIECE_MS = 320;

/** Where a sentence sits in the stream its reveal opened, and how fast that stream runs. */
export type FlowTiming = {
  start: number;
  step: number;
};

/**
 * The words of a sentence, each carrying the spaces and punctuation that follow it, so joining the
 * pieces back together gives the sentence exactly as it was written. Japanese has no spaces to split
 * on, so the locale decides where the words are.
 */
export function flowPieces(text: string, lang: Lang): string[] {
  const pieces: string[] = [];
  for (const { segment, isWordLike } of new Intl.Segmenter(lang, { granularity: "word" }).segment(text)) {
    if (isWordLike || pieces.length === 0) pieces.push(segment);
    else pieces[pieces.length - 1] += segment;
  }
  return pieces;
}

/**
 * The words of a sentence run by run, so a link is never cut in half. A citation marker is one piece
 * whatever it holds: it is a marker to follow, not words to read.
 */
export function flowRuns(runs: Run[], lang: Lang): string[][] {
  return runs.map((run) => (run.kind === "note" ? [run.text] : flowPieces(run.text, lang)));
}

/** How many words a split sentence arrives in, across its runs. */
export function flowWords(split: string[][]): number {
  return split.reduce((total, pieces) => total + pieces.length, 0);
}

/** Where each sentence of one reveal falls in the stream, given how many words each arrives in. */
export function flowTimings(counts: number[]): FlowTiming[] {
  const words = counts.reduce((total, count) => total + count, 0);
  const step = Math.min(PIECE_STEP_MS, (BATCH_MS - FLOW_PIECE_MS) / Math.max(1, words - 1));
  let before = 0;
  return counts.map((count) => {
    const start = Math.round(before * step);
    before += count;
    return { start, step };
  });
}

/** How long word `index` of a sentence waits, given where its reveal placed that sentence. */
export function flowDelay(index: number, timing: FlowTiming): number {
  return Math.round(timing.start + index * timing.step);
}
