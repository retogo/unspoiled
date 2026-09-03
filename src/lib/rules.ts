/** Whether a rule follows the reader from article to article, or belongs to the one it was made on. */
export type RuleScope = "article" | "all";

/**
 * Who added the rule. It decides what the reader is shown: their own phrases are their own words,
 * and an agent's are withheld until asked for, because the phrase an agent picks to hide a spoiler
 * is very often the spoiler.
 */
export type RuleOrigin = "reader" | "agent";

/**
 * A standing instruction to withhold any sentence carrying one of these phrases. `label` is what
 * the reader is shown for it, and is the only part of an agent's rule that reaches the screen on
 * its own; `reason` is why the agent added it.
 */
export type Rule = {
  id: string;
  phrases: string[];
  label: string;
  scope: RuleScope;
  origin: RuleOrigin;
  reason?: string;
  at: number;
};

/**
 * What two pieces of text are compared as. A reader typing a phrase means the thing they typed,
 * not the width and case they happened to type it in, so both sides are folded to one spelling
 * first: NFKC settles full-width against half-width, and lowering settles the rest.
 */
export function fold(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

function matches(rule: Rule, folded: string): boolean {
  return rule.phrases.some((phrase) => {
    const needle = fold(phrase).trim();
    return needle !== "" && folded.includes(needle);
  });
}

/** The first rule this text falls foul of, or null if it falls foul of none. */
export function matchingRule(text: string, rules: readonly Rule[]): Rule | null {
  const folded = fold(text);
  return rules.find((rule) => matches(rule, folded)) ?? null;
}

/** How many sentences of an article a rule reaches, which is what the reader is shown for it. */
export function countMatching(rule: Rule, texts: readonly string[]): number {
  return texts.filter((text) => matches(rule, fold(text))).length;
}

/**
 * The next name to give a rule. Rules are stored across sessions and across articles, so the name
 * counts past every one already stored rather than from the length of any one list.
 */
export function nextRuleId(existing: readonly Rule[]): string {
  const numbers = existing.map((rule) => Number(/^r(\d+)$/.exec(rule.id)?.[1] ?? 0));
  return `r${Math.max(0, ...numbers) + 1}`;
}
