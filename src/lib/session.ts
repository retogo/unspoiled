import { DEFAULT_SENSITIVITY, newPolicy, type Policy } from "./risk";
import type { Article, Section } from "./segment";
import type { Lang } from "./wikipedia";

const LANGS: Lang[] = ["en", "ja"];

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
 * new article that the reader never said they knew.
 */
export function policyForOpened(policy: Policy, open: Article | null, opened: Article): Policy {
  if (isSameArticle(open, opened)) return policy;
  return newPolicy(policy.sensitivity);
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
