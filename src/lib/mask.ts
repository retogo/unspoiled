import type { Lang } from "./wikipedia";

/**
 * A withheld paragraph is drawn as a band of fill rather than a line of prose, so its height is the
 * only thing that says how much is behind it. The height is not the paragraph's real line count: at
 * the width the article reads in, every plot paragraph runs past three lines and the bands would all
 * come out the same. It is a compressed measure of quantity instead — one row per `CHARS_PER_ROW`
 * characters, half that for Japanese, which fits twice as much in the same width — chosen so the
 * lengths Wikipedia paragraphs actually run to spread across `MAX_ROWS` distinguishable heights.
 */
const CHARS_PER_ROW = 250;
const MAX_ROWS = 5;

export function maskRows(charCount: number, lang: Lang): number {
  const perRow = lang === "ja" ? CHARS_PER_ROW / 2 : CHARS_PER_ROW;
  return Math.min(MAX_ROWS, Math.max(1, Math.round(charCount / perRow)));
}
