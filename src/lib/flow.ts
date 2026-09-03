import type { Lang } from "./wikipedia";

/**
 * A sentence the reader opened arrives a word at a time, from the front, and the sentences of one
 * reveal arrive one after another rather than together. Neighbouring words are `PIECE_STEP_MS`
 * apart, a long sentence compresses that step so it never spends more than `SENTENCE_SPREAD_MS`
 * arriving, and each word then takes `FLOW_PIECE_MS` to resolve — the duration `.unspoiled-flow`
 * carries in `index.css`. A sentence therefore takes at most `SENTENCE_SLOT_MS` and the next one
 * waits that long, until a reveal opens so many that the whole run would outlast `BATCH_MS` and the
 * gap tightens instead.
 */
const PIECE_STEP_MS = 20;
const SENTENCE_SPREAD_MS = 300;
const BATCH_MS = 2800;

export const FLOW_PIECE_MS = 320;

const SENTENCE_SLOT_MS = SENTENCE_SPREAD_MS + FLOW_PIECE_MS;

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

/** When the `order`-th of the `opened` sentences that one reveal opened begins to arrive. */
export function flowStart(order: number, opened: number): number {
  if (opened < 2) return 0;
  const slot = Math.min(SENTENCE_SLOT_MS, (BATCH_MS - SENTENCE_SLOT_MS) / (opened - 1));
  return Math.round(order * slot);
}

/** How long piece `index` of a sentence of `count` pieces waits, given when that sentence begins. */
export function flowDelay(index: number, count: number, start: number): number {
  const step = Math.min(PIECE_STEP_MS, SENTENCE_SPREAD_MS / Math.max(1, count - 1));
  return Math.round(start + index * step);
}
