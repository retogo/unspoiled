import type { Lang } from "./wikipedia";

/**
 * A sentence the reader opened arrives a word at a time, from the front. These are the timings that
 * shape it: neighbouring words are `PIECE_STEP_MS` apart, a long sentence compresses that step so it
 * never spends more than `SENTENCE_SPREAD_MS` arriving, and a reveal that opens several sentences
 * starts each one `SENTENCE_STEP_MS` after the last until `BATCH_SPREAD_MS` stops the wait growing.
 */
const PIECE_STEP_MS = 20;
const SENTENCE_SPREAD_MS = 300;
const SENTENCE_STEP_MS = 90;
const BATCH_SPREAD_MS = 540;

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

/** How long piece `index` of a sentence of `count` pieces waits, when it is the `order`-th opened. */
export function flowDelay(index: number, count: number, order: number): number {
  const step = Math.min(PIECE_STEP_MS, SENTENCE_SPREAD_MS / Math.max(1, count - 1));
  return Math.round(Math.min(order * SENTENCE_STEP_MS, BATCH_SPREAD_MS) + index * step);
}
