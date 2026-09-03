import type { Run } from "./segment";
import type { Lang } from "./wikipedia";

/**
 * A sentence the reader opened arrives a word at a time, from the front, and the sentences of one
 * reveal arrive one after another rather than together. Neighbouring words are `PIECE_STEP_MS`
 * apart, a long sentence compressing that step so it never spends more than `SENTENCE_SPREAD_MS`
 * arriving, and each word then takes `FLOW_PIECE_MS` to resolve — the duration `.unspoiled-flow`
 * carries in `index.css`. The next sentence starts `SENTENCE_GAP_MS` after the last word of the one
 * before it has begun to arrive, so the wait is the length of the sentence being read rather than a
 * fixed beat, and a short sentence is followed closely. Only when a reveal opens so many that the
 * run would outlast `BATCH_MS` is the whole thing tightened, in proportion, so the long and the
 * short of it keep their relative weight.
 */
const PIECE_STEP_MS = 20;
const SENTENCE_SPREAD_MS = 300;
const SENTENCE_GAP_MS = 150;
const BATCH_MS = 2800;

export const FLOW_PIECE_MS = 320;

function pieceStep(count: number): number {
  return Math.min(PIECE_STEP_MS, SENTENCE_SPREAD_MS / Math.max(1, count - 1));
}

/** How long a sentence of `count` words spends arriving, from its first word to its last. */
function spread(count: number): number {
  return Math.max(0, count - 1) * pieceStep(count);
}

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

/** When each sentence of one reveal begins, given how many words each of them arrives in. */
export function flowStarts(counts: number[]): number[] {
  let at = 0;
  const starts = counts.map((count) => {
    const start = at;
    at += spread(count) + SENTENCE_GAP_MS;
    return start;
  });

  const last = starts.length - 1;
  const limit = BATCH_MS - spread(counts[last]) - FLOW_PIECE_MS;
  const tighten = starts[last] > limit ? limit / starts[last] : 1;
  return starts.map((start) => Math.round(start * tighten));
}

/** How long piece `index` of a sentence of `count` pieces waits, given when that sentence begins. */
export function flowDelay(index: number, count: number, start: number): number {
  return Math.round(start + index * pieceStep(count));
}
