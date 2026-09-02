import { defaultPolicy, type Policy } from "./risk";
import type { Article } from "./segment";
import type { Lang } from "./wikipedia";

const LEVELS: Policy["level"][] = ["strict", "balanced", "open"];
const LANGS: Lang[] = ["en", "ja"];

export type SharedArticle = { lang: Lang; title: string };

export type SessionStart = {
  policy: Policy;
  article: SharedArticle | null;
};

export type ScannedSection = {
  articleKey: string;
  articleTitle: string;
  sectionId: string;
};

function asLevel(raw: string | null): Policy["level"] | null {
  return LEVELS.find((level) => level === raw) ?? null;
}

function asLang(raw: string | null): Lang | null {
  return LANGS.find((lang) => lang === raw) ?? null;
}

/**
 * A shared link may carry any string, so it is treated as untrusted input: the
 * reader's stored level wins over the one in the link, and a level that arrives
 * from either source is only used when it names a real policy.
 */
export function readSessionStart(search: string, storedLevel: string | null): SessionStart {
  const params = new URLSearchParams(search);
  const level = asLevel(storedLevel) ?? asLevel(params.get("level")) ?? defaultPolicy.level;
  const title = params.get("title");
  return {
    policy: { ...defaultPolicy, level },
    article: title ? { lang: asLang(params.get("lang")) ?? "en", title } : null,
  };
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
  return { ...defaultPolicy, level: policy.level };
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
