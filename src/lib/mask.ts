import type { Lang } from "./wikipedia";

/**
 * A withheld paragraph is drawn as a band of fill rather than a line of prose, so its height is the
 * only thing that says how much is behind it. It stands as tall as the text would run, at a line of
 * roughly `CHARS_PER_ROW` — half that for Japanese, which fits twice as much in the same width — and
 * stops at `MAX_ROWS` so a long section is a column of bands and not a wall of them.
 */
const CHARS_PER_ROW = 90;
const MAX_ROWS = 3;

export function maskRows(charCount: number, lang: Lang): number {
  const perRow = lang === "ja" ? CHARS_PER_ROW / 2 : CHARS_PER_ROW;
  return Math.min(MAX_ROWS, Math.max(1, Math.ceil(charCount / perRow)));
}
