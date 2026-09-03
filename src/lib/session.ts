import { DEFAULT_SENSITIVITY, headingId, newPolicy, type Policy } from "./risk";
import type { Article, Section } from "./segment";
import type { Lang } from "./wikipedia";

const LANGS: Lang[] = ["en", "ja"];

export type SharedArticle = { lang: Lang; title: string };

export type SessionStart = {
  policy: Policy;
  article: SharedArticle | null;
};

/**
 * One section a tool opened for the agent, and the ids of the sentences and headings whose text
 * that tool actually handed over. The ids are what lets the page state, in one place, exactly how
 * much of the article left it — the section alone would say a whole plot was read when one
 * sentence was.
 */
export type ScannedSection = {
  articleKey: string;
  articleTitle: string;
  sectionId: string;
  sent: string[];
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
 * A shared link may carry any string, so it is treated as untrusted input: the
 * reader's stored sensitivity wins over the one in the link, and a sensitivity
 * that arrives from either source is only used when it is a whole number on the
 * scale.
 */
export function readSessionStart(search: string, storedSensitivity: string | null): SessionStart {
  const params = new URLSearchParams(search);
  const sensitivity =
    asSensitivity(storedSensitivity) ?? asSensitivity(params.get("sensitivity")) ?? DEFAULT_SENSITIVITY;
  const title = params.get("title");
  return {
    policy: newPolicy(sensitivity),
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

export function recordScanned(
  scanned: ScannedSection[],
  article: Article,
  sectionId: string,
  sent: string[],
): ScannedSection[] {
  const key = articleKey(article.lang, article.title);
  const read = scanned.find((entry) => entry.articleKey === key && entry.sectionId === sectionId);
  if (!read) {
    return [...scanned, { articleKey: key, articleTitle: article.displayTitle, sectionId, sent }];
  }
  const merged = new Set([...read.sent, ...sent]);
  return scanned.map((entry) => (entry === read ? { ...entry, sent: [...merged] } : entry));
}

/** Every id in a section that can be revealed or handed to the agent: its heading and its sentences. */
function idsIn(section: Section): string[] {
  return [headingId(section), ...section.paragraphs.flatMap((paragraph) => paragraph.sentences.map((s) => s.id))];
}

function disclosedBySection(article: Article | null, disclosed: (id: string) => boolean): SectionDisclosure[] {
  if (!article) return [];
  return article.sections.flatMap((section) => {
    const ids = idsIn(section).filter(disclosed);
    return ids.length > 0 ? [{ section, ids }] : [];
  });
}

/** What the reader or their agent has opened in the article on screen, section by section. */
export function revealedOnPage(article: Article | null, policy: Policy): SectionDisclosure[] {
  return disclosedBySection(article, (id) => policy.revealed.has(id));
}

/** What a tool has handed to the agent out of the article on screen, section by section. */
export function sentToAgent(scanned: ScannedSection[], article: Article | null): SectionDisclosure[] {
  const key = article ? articleKey(article.lang, article.title) : null;
  const sent = new Set(
    scanned.filter((entry) => entry.articleKey === key).flatMap((entry) => entry.sent),
  );
  return disclosedBySection(article, (id) => sent.has(id));
}

/**
 * What the agent was handed out of articles the reader has since navigated away from. Only a count
 * survives: the ids are positional and mean nothing once another article is open.
 */
export function sentElsewhere(
  scanned: ScannedSection[],
  article: Article | null,
): { articleTitle: string; sentences: number }[] {
  const key = article ? articleKey(article.lang, article.title) : null;
  const elsewhere = new Map<string, { articleTitle: string; sentences: number }>();
  for (const entry of scanned) {
    if (entry.articleKey === key) continue;
    const group = elsewhere.get(entry.articleKey);
    if (group) group.sentences += entry.sent.length;
    else elsewhere.set(entry.articleKey, { articleTitle: entry.articleTitle, sentences: entry.sent.length });
  }
  return [...elsewhere.values()];
}
