import { useCallback, useEffect, useState } from "react";
import { nextHighlight, requestOrder, SUGGEST_DEBOUNCE_MS, suggestable } from "./lib/suggest";
import { searchArticles, type Lang, type SearchHit } from "./lib/wikipedia";

export type Suggestions = {
  hits: SearchHit[];
  active: number;
  error: string | null;
  move: (step: -1 | 1) => void;
  searchNow: () => void;
  clear: () => void;
};

/**
 * What the box has found for what the reader has typed so far. A search waits for them to pause and
 * never runs while an IME conversion is still open, so a term is asked about once it is a term, and
 * the answer to a question the reader has already typed past is dropped rather than shown.
 */
export function useSuggestions(lang: Lang, term: string, composing: boolean): Suggestions {
  const [found, setFound] = useState<SearchHit[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const [failure, setFailure] = useState<string | null>(null);
  /** The term whose suggestions the reader put away. Typing past it is asking again. */
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [order] = useState(requestOrder);

  const asking = !composing && suggestable(term) && dismissed !== term;
  const hits = asking ? found : [];
  const active = hits.length === 0 ? -1 : Math.min(highlight, hits.length - 1);

  const run = useCallback(
    async (searchLang: Lang, searchTerm: string) => {
      const ticket = order.take();
      try {
        const answer = await searchArticles(searchLang, searchTerm);
        if (!order.isCurrent(ticket)) return;
        setFound(answer);
        /** The first row is offered, so Enter opens the best match without an arrow key. */
        setHighlight(0);
        setFailure(null);
      } catch (cause) {
        if (!order.isCurrent(ticket)) return;
        setFound([]);
        setFailure(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [order],
  );

  useEffect(() => {
    if (!asking) return;
    const timer = window.setTimeout(() => void run(lang, term), SUGGEST_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [asking, lang, run, term]);

  const move = useCallback(
    (step: -1 | 1) => setHighlight(nextHighlight(active, step, hits.length)),
    [active, hits.length],
  );

  /** Enter before the reader has paused long enough asks the question the debounce is still holding. */
  const searchNow = useCallback(() => {
    if (!suggestable(term)) return;
    setDismissed(null);
    void run(lang, term);
  }, [lang, run, term]);

  const clear = useCallback(() => setDismissed(term), [term]);

  return { hits, active, error: asking ? failure : null, move, searchNow, clear };
}
