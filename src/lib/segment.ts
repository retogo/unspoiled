import type { FetchedArticle, Lang } from "./wikipedia";

/**
 * A stretch of a sentence that carries something more than its characters: a link to another
 * article, a link off the site, or a citation marker. Joining the text of every run but the notes
 * gives the sentence back exactly as `text` holds it — notes are markers the reader can follow, not
 * words of the sentence, and nothing that reads `text` ever sees them.
 */
export type Run =
  | { kind: "text"; text: string }
  | { kind: "wiki"; text: string; title: string }
  | { kind: "external"; text: string; href: string }
  | { kind: "note"; text: string; noteId: string };

export type Sentence = {
  id: string;
  text: string;
  runs: Run[];
};

export type Paragraph = {
  id: string;
  sentences: Sentence[];
};

export type Section = {
  id: string;
  heading: string;
  headingPath: string[];
  level: number;
  paragraphs: Paragraph[];
};

/** One entry of the article's citation list, kept whole so a footnote marker has somewhere to land. */
export type Reference = {
  id: string;
  runs: Run[];
};

export type Article = {
  lang: Lang;
  title: string;
  displayTitle: string;
  sourceUrl: string;
  sections: Section[];
  references: Reference[];
};

const LEAD_HEADING = "(lead)";

const BLOCK_SELECTOR = "p, li, dd, dt, tr";

const NON_BODY_SELECTOR = [
  ".infobox",
  ".navbox",
  ".navbox-styles",
  ".sidebar",
  ".metadata",
  ".ambox",
  ".hatnote",
  ".rellink",
  ".shortdescription",
  ".reflist",
  ".references",
  ".toc",
  "[class*='toclimit']",
  "figure",
  ".thumb",
  ".gallery",
  ".portalbox",
  ".navigation-not-searchable",
  ".mw-empty-elt",
  ".noprint",
].join(", ");

const NON_CONTENT_SELECTOR = ".mw-editsection, .noprint, style";

/** What leads from a citation back to the sentences citing it: the caret, and the a/b/c letters. */
const BACKLINK_SELECTOR = ".mw-cite-backlink, a[href^='#cite_ref']";

/** Links into these namespaces point at a file, a policy page or a listing rather than an article. */
const NON_ARTICLE_NAMESPACE =
  /^(?:File|Image|Media|Help|Wikipedia|Special|Category|Template|Portal|Talk|Module|ファイル|特別|カテゴリ|プロジェクト|ヘルプ|利用者)[:：]/i;

const MIN_PROSE_LENGTH = 40;
const MIN_COMPACT_LENGTH = 4;

function headingOf(element: Element): { text: string; level: number } | null {
  const heading = element.matches("h2, h3, h4")
    ? element
    : element.querySelector(":scope > h2, :scope > h3, :scope > h4");
  if (!heading) return null;
  return {
    text: heading.textContent?.trim() ?? "",
    level: Number(heading.tagName.slice(1)),
  };
}

function isHeaderRow(block: Element): boolean {
  return block.tagName === "TR" && !block.querySelector("td");
}

function blocksIn(element: Element): Element[] {
  const nested = Array.from(element.querySelectorAll(BLOCK_SELECTOR));
  const candidates = element.matches(BLOCK_SELECTOR) ? [element, ...nested] : nested;
  return candidates.filter((block) => !block.closest(NON_BODY_SELECTOR) && !isHeaderRow(block));
}

/** The page name a `/wiki/…` link points at, or null when it does not name an article of its own. */
function articleTitle(link: HTMLAnchorElement): string | null {
  const path = link.getAttribute("href") ?? "";
  if (!path.startsWith("/wiki/")) return null;
  if (link.classList.contains("new")) return null;
  const title = decodeURIComponent(path.slice("/wiki/".length).split("#")[0]).replace(/_/g, " ");
  if (title.length === 0 || NON_ARTICLE_NAMESPACE.test(title)) return null;
  return title;
}

function externalHref(link: HTMLAnchorElement): string | null {
  const href = link.getAttribute("href") ?? "";
  return /^https?:\/\//.test(href) ? href : null;
}

/** The citation a marker points at: `#cite_note-boxofficemojo-1`, not the number the reader sees. */
function noteTarget(marker: Element): string | null {
  const href = marker.querySelector("a")?.getAttribute("href") ?? "";
  return href.startsWith("#cite_note") ? href.slice(1) : null;
}

function textRun(text: string): Run {
  return { kind: "text", text };
}

function collectRuns(node: Node, into: Run[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    into.push(textRun(node.nodeValue ?? ""));
    return;
  }
  if (!(node instanceof Element)) return;
  if (node.matches(NON_CONTENT_SELECTOR) || node.matches(BACKLINK_SELECTOR)) return;

  if (node.matches("sup.reference")) {
    const noteId = noteTarget(node);
    if (noteId) into.push({ kind: "note", text: node.textContent ?? "", noteId });
    return;
  }

  if (node instanceof HTMLAnchorElement) {
    const text = node.textContent ?? "";
    const title = articleTitle(node);
    if (title) {
      into.push({ kind: "wiki", text, title });
      return;
    }
    const href = externalHref(node);
    into.push(href ? { kind: "external", text, href } : textRun(text));
    return;
  }

  if (node.matches("br")) {
    into.push(textRun(" "));
    return;
  }

  for (const child of Array.from(node.childNodes)) collectRuns(child, into);
}

/**
 * Runs come out of the DOM carrying the source's line breaks and indentation. Squeezing that down to
 * single spaces has to happen across the whole sequence rather than run by run, or a space split
 * over a link boundary would survive on both sides of it.
 */
function tidy(runs: Run[]): Run[] {
  const tidied: Run[] = [];
  let trailingSpace = true;
  for (const run of runs) {
    if (run.kind === "note") {
      tidied.push({ ...run, text: run.text.replace(/\s+/g, " ").trim() });
      continue;
    }
    let text = run.text.replace(/\[\d+\]/g, "").replace(/\s+/g, " ");
    if (trailingSpace) text = text.replace(/^ /, "");
    if (text.length === 0) continue;
    trailingSpace = text.endsWith(" ");
    const last = tidied[tidied.length - 1];
    if (run.kind === "text" && last?.kind === "text") last.text += text;
    else tidied.push({ ...run, text });
  }
  for (let last = tidied.length - 1; last >= 0; last -= 1) {
    const run = tidied[last];
    if (run.kind === "note") continue;
    const text = run.text.replace(/ $/, "");
    if (text.length === 0) tidied.splice(last, 1);
    else tidied[last] = { ...run, text };
    break;
  }
  return tidied.filter((run) => run.text.length > 0);
}

function runsText(runs: Run[]): string {
  return runs
    .filter((run) => run.kind !== "note")
    .map((run) => run.text)
    .join("");
}

/**
 * The text a block contributes on its own: nested blocks are collected separately, so a list item
 * holding a sublist keeps only its own line. A table row contributes one run list per cell.
 */
function runsOf(block: Element): Run[][] {
  const clone = block.cloneNode(true) as Element;
  for (const inner of Array.from(clone.querySelectorAll(BLOCK_SELECTOR))) inner.remove();
  for (const styled of Array.from(clone.querySelectorAll<HTMLElement>("[style]"))) {
    if (styled.style.display === "none") styled.remove();
  }
  const cells = Array.from(clone.querySelectorAll("th, td"));
  return (cells.length > 0 ? cells : [clone])
    .map((cell) => {
      const runs: Run[] = [];
      for (const child of Array.from(cell.childNodes)) collectRuns(child, runs);
      return tidy(runs);
    })
    .filter((runs) => runsText(runs).length > 0);
}

type Range = { start: number; end: number };

/** Where each sentence starts and ends in the block's text, with the space between them dropped. */
function sentenceRanges(text: string, lang: Lang): Range[] {
  const pattern = lang === "ja" ? /(?<=[。！？])/g : /(?<=[.!?])\s+(?=[A-Z"'(“])/g;
  const ranges: Range[] = [];
  const add = (from: number, to: number) => {
    let start = from;
    let end = to;
    while (start < end && /\s/.test(text[start])) start += 1;
    while (end > start && /\s/.test(text[end - 1])) end -= 1;
    if (start < end) ranges.push({ start, end });
  };

  let start = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    add(start, match.index);
    start = match.index + match[0].length;
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
  add(start, text.length);
  return ranges;
}

/**
 * Cuts the block's runs at its sentence boundaries. A link crossing a boundary is cut with it, and a
 * citation marker — which occupies no room in the text — goes to the sentence it was written after.
 */
function splitRuns(runs: Run[], lang: Lang): Sentence[] {
  const ranges = sentenceRanges(runsText(runs), lang);
  if (ranges.length === 0) return [];
  const parts: Run[][] = ranges.map(() => []);
  let offset = 0;
  let at = 0;

  for (const run of runs) {
    if (run.kind === "note") {
      while (at < ranges.length - 1 && ranges[at].end < offset) at += 1;
      parts[at].push(run);
      continue;
    }
    const start = offset;
    offset += run.text.length;
    ranges.forEach((range, index) => {
      const from = Math.max(range.start, start);
      const to = Math.min(range.end, offset);
      if (to > from) parts[index].push({ ...run, text: run.text.slice(from - start, to - start) });
    });
  }

  return parts.map((part) => ({ id: "", text: runsText(part), runs: part }));
}

/**
 * The backlinks that lead from a citation to the places it is cited are navigation, not the entry.
 * The English edition wraps them, the Japanese one leaves them loose in the item, so the citation is
 * taken from `.reference-text` where the wikis agree on what the entry itself is.
 */
function referencesIn(container: Element): Reference[] {
  return Array.from(container.querySelectorAll("ol.references > li"))
    .map((item) => {
      const runs: Run[] = [];
      for (const child of Array.from((item.querySelector(".reference-text") ?? item).childNodes)) {
        collectRuns(child, runs);
      }
      return { id: item.id, runs: tidy(runs) };
    })
    .filter((reference) => reference.id.length > 0 && reference.runs.length > 0);
}

export function segmentArticle(fetched: FetchedArticle): Article {
  const container = new DOMParser()
    .parseFromString(fetched.html, "text/html")
    .querySelector(".mw-parser-output");

  const sections: Section[] = [];
  const ancestors: { text: string; level: number }[] = [];
  let current: Section = {
    id: "s0",
    heading: LEAD_HEADING,
    headingPath: [LEAD_HEADING],
    level: 2,
    paragraphs: [],
  };
  let paragraphCount = 0;

  for (const element of Array.from(container?.children ?? [])) {
    const heading = headingOf(element);
    if (heading) {
      sections.push(current);
      while (ancestors.length > 0 && ancestors[ancestors.length - 1].level >= heading.level) {
        ancestors.pop();
      }
      ancestors.push(heading);
      current = {
        id: `s${sections.length}`,
        heading: heading.text,
        headingPath: ancestors.map((ancestor) => ancestor.text),
        level: heading.level,
        paragraphs: [],
      };
      continue;
    }

    for (const block of blocksIn(element)) {
      const cells = runsOf(block);
      const minLength = block.tagName === "P" ? MIN_PROSE_LENGTH : MIN_COMPACT_LENGTH;
      if (cells.map(runsText).join(" ").length < minLength) continue;
      const id = `p${paragraphCount++}`;
      current.paragraphs.push({
        id,
        sentences: cells
          .flatMap((runs) => splitRuns(runs, fetched.lang))
          .map((sentence, position) => ({ ...sentence, id: `${id}.${position}` })),
      });
    }
  }
  sections.push(current);

  return {
    lang: fetched.lang,
    title: fetched.title,
    displayTitle: fetched.displayTitle,
    sourceUrl: fetched.sourceUrl,
    sections: sections.filter((section) => section.paragraphs.length > 0),
    references: container ? referencesIn(container) : [],
  };
}

export function isLead(section: Section): boolean {
  return section.heading === LEAD_HEADING;
}

export function sectionHeading(section: Section): string {
  return isLead(section) ? "Overview" : section.heading;
}
