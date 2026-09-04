/** Whether a rule follows the reader from article to article, or belongs to the one it was made on. */
export type RuleScope = "article" | "all";

/** What every rule holds, whoever made it: the phrases to look for and what it is called. */
type RuleBody = {
  phrases: string[];
  label: string;
  scope: RuleScope;
};

/** The page's own name for a rule, and when it was made. Neither party writes these. */
type RuleName = {
  id: string;
  at: number;
};

/**
 * A rule before the page has named it: what an agent asks for, and what the reader's own phrase
 * becomes.
 *
 * Who made it decides two things. An agent's rule always says why it was added, because the label
 * and that reason are all the reader has to judge it by; the reader's own phrase explains itself.
 * And the reader's phrases are their own words, where an agent's are withheld until asked for,
 * because the phrase an agent picks to catch a spoiler is very often the spoiler.
 */
export type RuleDraft =
  | (RuleBody & { origin: "reader" })
  | (RuleBody & { origin: "agent"; reason: string });

/** A standing instruction to withhold any sentence carrying one of its phrases. */
export type Rule =
  | (RuleBody & RuleName & { origin: "reader" })
  | (RuleBody & RuleName & { origin: "agent"; reason: string });

export type RuleOrigin = Rule["origin"];

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

/** These drafts as rules, each named past the ones already stored and the ones beside it. */
export function namedRules(drafts: readonly RuleDraft[], existing: readonly Rule[], at: number): Rule[] {
  return drafts.reduce<Rule[]>(
    (named, draft) => [...named, { ...draft, id: nextRuleId([...existing, ...named]), at }],
    [],
  );
}
