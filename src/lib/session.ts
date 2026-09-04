import { DEFAULT_SENSITIVITY, newPolicy, type Policy } from "./risk";
import type { Rule, RuleScope } from "./rules";
import type { Article, Section } from "./segment";
import type { Lang } from "./wikipedia";

const LANGS: Lang[] = ["en", "ja"];

export const RULES_KEY = "unspoiled.rules";

export type SharedArticle = { lang: Lang; title: string };

export type SessionStart = {
  policy: Policy;
  article: SharedArticle | null;
};

/**
 * One section the agent has read in full. Reading is what the agent is for, so the page keeps the
 * record rather than a measure of it: the reader is told which sections their agent knows, and can
 * see that the list matches the sections it asked for.
 */
export type ScannedSection = {
  articleKey: string;
  articleTitle: string;
  sectionId: string;
};

/** A run of ids disclosed out of one section, ready to be labelled with that section's heading. */
export type SectionDisclosure = {
  section: Section;
  ids: string[];
};

function asSensitivity(raw: string | null): number | null {
  if (raw === null || !/^\d{1,3}$/.test(raw)) return null;
  const sensitivity = Number(raw);
  return sensitivity <= 100 ? sensitivity : null;
}

function asLang(raw: string | null): Lang | null {
  return LANGS.find((lang) => lang === raw) ?? null;
}

/**
 * The article a URL names, or null for the search screen. A URL may carry any
 * string, so the language counts only when it is an edition the reader could
 * have picked; anything else reads as English rather than as a host to fetch
 * from.
 */
export function readArticleTarget(search: string): SharedArticle | null {
  const params = new URLSearchParams(search);
  const title = params.get("title");
  return title ? { lang: asLang(params.get("lang")) ?? "en", title } : null;
}

/**
 * A shared link may carry any string, so it is treated as untrusted input: the
 * reader's stored sensitivity wins over the one in the link, and a sensitivity
 * that arrives from either source is only used when it is a whole number on the
 * scale.
 */
export function readSessionStart(search: string, storedSensitivity: string | null): SessionStart {
  const params = new URLSearchParams(search);
  const sensitivity =
    asSensitivity(storedSensitivity) ?? asSensitivity(params.get("sensitivity")) ?? DEFAULT_SENSITIVITY;
  return { policy: newPolicy(sensitivity), article: readArticleTarget(search) };
}

/**
 * How the URL for `next` should join the browser's history. A different article
 * is somewhere else and earns its own entry, so the back button returns to the
 * one before it. Everything else rewrites the entry in place: the same article
 * opened again, the sensitivity moving, and the first URL this page writes over
 * the one the browser already has, which `undefined` stands for.
 */
export function historyActionFor(
  previous: SharedArticle | null | undefined,
  next: SharedArticle | null,
): "push" | "replace" {
  if (previous === undefined) return "replace";
  if (previous === null || next === null) return previous === next ? "replace" : "push";
  return previous.lang === next.lang && previous.title === next.title ? "replace" : "push";
}

export function articleKey(lang: Lang, title: string): string {
  return `${lang}:${title}`;
}

function isSameArticle(open: Article | null, opened: Article): boolean {
  return open !== null && open.lang === opened.lang && open.title === opened.title;
}

/**
 * Sentence and section ids are positional, so every id in the policy belongs to
 * the article it was collected in. Opening a different article drops them all —
 * keeping them would hide unrelated sentences and, worse, unhide sections of the
 * new article that the reader never said they knew. Rules are phrases rather than
 * ids, so the ones that apply to the article being opened come with it.
 */
export function policyForOpened(policy: Policy, open: Article | null, opened: Article, rules: Rule[]): Policy {
  if (isSameArticle(open, opened)) return policy;
  return newPolicy(policy.sensitivity, rules);
}

/**
 * Every rule the reader has, split by where it applies: `all` follows them from article to
 * article, and each entry of `byArticle` belongs to the one it was made on. Both live in one
 * localStorage entry, because a rule is the reader's own setting and outlives the session.
 */
export type RuleStore = {
  all: Rule[];
  byArticle: Record<string, Rule[]>;
};

const NO_RULES: RuleStore = { all: [], byArticle: {} };

const SCOPES: RuleScope[] = ["article", "all"];

/**
 * One stored entry, or null if it is not a rule. Nothing here is defensive about the page's own
 * writing: localStorage is the reader's, an older version of this page may have written a different
 * shape into it, and a rule that arrived broken must not decide what is on the screen. An agent's
 * rule with no reason left in it is one of those: the reader would have nothing to judge it by.
 */
function asRule(value: unknown): Rule | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, phrases, label, scope, origin, reason, at } = value as Record<string, unknown>;
  if (typeof id !== "string" || id === "") return null;
  if (typeof label !== "string" || label.trim() === "") return null;
  if (!Array.isArray(phrases)) return null;
  const kept = phrases.filter((phrase): phrase is string => typeof phrase === "string" && phrase.trim() !== "");
  if (kept.length !== phrases.length || kept.length === 0) return null;
  const wanted = SCOPES.find((candidate) => candidate === scope);
  if (!wanted) return null;
  const body = { id, phrases: kept, label, scope: wanted, at: typeof at === "number" ? at : 0 };
  if (origin === "reader") return { ...body, origin };
  if (origin === "agent" && typeof reason === "string" && reason.trim() !== "") {
    return { ...body, origin, reason };
  }
  return null;
}

function asRules(value: unknown): Rule[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const rule = asRule(entry);
    return rule ? [rule] : [];
  });
}

export function readRuleStore(raw: string | null): RuleStore {
  if (raw === null || raw === "") return NO_RULES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NO_RULES;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return NO_RULES;
  const { all, byArticle } = parsed as Record<string, unknown>;
  const buckets: Record<string, Rule[]> = {};
  if (typeof byArticle === "object" && byArticle !== null && !Array.isArray(byArticle)) {
    for (const [key, value] of Object.entries(byArticle)) {
      const rules = asRules(value);
      if (rules.length > 0) buckets[key] = rules;
    }
  }
  return { all: asRules(all), byArticle: buckets };
}

/** The rules in force on the article on screen, or on the search screen the ones that always are. */
export function rulesFor(store: RuleStore, article: SharedArticle | null): Rule[] {
  const key = article ? articleKey(article.lang, article.title) : null;
  return [...store.all, ...(key === null ? [] : (store.byArticle[key] ?? []))];
}

/** Every rule the reader holds, wherever it applies. Their names are counted past all of these. */
export function allRules(store: RuleStore): Rule[] {
  return [...store.all, ...Object.values(store.byArticle).flat()];
}

/**
 * The store with these rules added, each one filed where its own scope says. A rule made for one
 * article needs that article, so the key is only absent on the search screen, where the only scope
 * the reader is offered is the one that follows them.
 */
export function storedWith(store: RuleStore, key: string | null, rules: readonly Rule[]): RuleStore {
  const all = [...store.all];
  const byArticle = { ...store.byArticle };
  for (const rule of rules) {
    if (rule.scope === "all" || key === null) all.push({ ...rule, scope: "all" });
    else byArticle[key] = [...(byArticle[key] ?? []), rule];
  }
  return { all, byArticle };
}

export function storedWithout(store: RuleStore, id: string): RuleStore {
  const byArticle: Record<string, Rule[]> = {};
  for (const [key, rules] of Object.entries(store.byArticle)) {
    const kept = rules.filter((rule) => rule.id !== id);
    if (kept.length > 0) byArticle[key] = kept;
  }
  return { all: store.all.filter((rule) => rule.id !== id), byArticle };
}

export function scannedForArticle(scanned: ScannedSection[], article: Article | null): string[] {
  if (!article) return [];
  const key = articleKey(article.lang, article.title);
  return scanned.filter((entry) => entry.articleKey === key).map((entry) => entry.sectionId);
}

/**
 * What the agent read in articles the reader has since navigated away from. The
 * headings are left out: a heading can be the spoiler, and these belong to an
 * article that is no longer on screen to be revealed.
 */
export function scannedElsewhere(
  scanned: ScannedSection[],
  article: Article | null,
): { articleTitle: string; sections: number }[] {
  const key = article ? articleKey(article.lang, article.title) : null;
  const elsewhere = new Map<string, { articleTitle: string; sections: number }>();
  for (const entry of scanned) {
    if (entry.articleKey === key) continue;
    const group = elsewhere.get(entry.articleKey);
    if (group) group.sections += 1;
    else elsewhere.set(entry.articleKey, { articleTitle: entry.articleTitle, sections: 1 });
  }
  return [...elsewhere.values()];
}

export function recordScanned(scanned: ScannedSection[], article: Article, sectionId: string): ScannedSection[] {
  const key = articleKey(article.lang, article.title);
  if (scanned.some((entry) => entry.articleKey === key && entry.sectionId === sectionId)) return scanned;
  return [...scanned, { articleKey: key, articleTitle: article.displayTitle, sectionId }];
}

function idsIn(section: Section): string[] {
  return section.paragraphs.flatMap((paragraph) => paragraph.sentences.map((sentence) => sentence.id));
}

function disclosedBySection(article: Article | null, disclosed: (id: string) => boolean): SectionDisclosure[] {
  if (!article) return [];
  return article.sections.flatMap((section) => {
    const ids = idsIn(section).filter(disclosed);
    return ids.length > 0 ? [{ section, ids }] : [];
  });
}

/**
 * What a decision has opened in the article on screen, section by section. A sentence a later
 * decision closed again is not open, whichever set it started in.
 */
export function revealedOnPage(article: Article | null, policy: Policy): SectionDisclosure[] {
  return disclosedBySection(article, (id) => policy.shown.has(id) && !policy.hidden.has(id));
}
