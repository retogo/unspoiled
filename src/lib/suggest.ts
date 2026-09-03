/**
 * The box searches as the reader types, so a search has to be worth making. A single letter matches
 * most of Wikipedia and the reader is still mid-word; two is the first length that narrows anything.
 */
export const SUGGEST_MIN_LENGTH = 2;

/**
 * Long enough that a reader typing at speed sends one request rather than one per keystroke, short
 * enough that the suggestions read as a consequence of typing rather than of stopping.
 */
export const SUGGEST_DEBOUNCE_MS = 250;

export function suggestable(term: string): boolean {
  return term.trim().length >= SUGGEST_MIN_LENGTH;
}

/**
 * Responses arrive in whatever order the network hands them back, so the box adopts only the answer
 * to the question it is still asking. Every request takes a ticket, and a response holding a ticket
 * the counter has moved past is dropped instead of overwriting the results of a later one.
 */
export type RequestOrder = {
  take: () => number;
  isCurrent: (ticket: number) => boolean;
};

export function requestOrder(): RequestOrder {
  let latest = 0;
  return {
    take: () => (latest += 1),
    isCurrent: (ticket: number) => ticket === latest,
  };
}

/**
 * Where the arrow keys move the highlight. What the reader typed is one more stop on the ring, at
 * -1, so walking off either end of the list hands them their own text back rather than trapping
 * them in the suggestions.
 */
export function nextHighlight(active: number, step: -1 | 1, count: number): number {
  if (count === 0) return -1;
  const stops = count + 1;
  return ((active + 1 + step + stops) % stops) - 1;
}
