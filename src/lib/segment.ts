import type { FetchedArticle, Lang } from "./wikipedia";

export type Sentence = {
  id: string;
  text: string;
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

export type Article = {
  lang: Lang;
  title: string;
  displayTitle: string;
  sourceUrl: string;
  sections: Section[];
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

const NON_CONTENT_SELECTOR = "sup.reference, .mw-editsection, .noprint, style";

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

function textOf(element: Element): string {
  return (element.textContent ?? "").replace(/\[\d+\]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * The text a block contributes on its own: nested blocks are collected separately, so a list item
 * holding a sublist keeps only its own line. A table row contributes one run per cell.
 */
function textRunsOf(block: Element): string[] {
  const clone = block.cloneNode(true) as Element;
  for (const inner of Array.from(clone.querySelectorAll(`${BLOCK_SELECTOR}, ${NON_CONTENT_SELECTOR}`))) {
    inner.remove();
  }
  for (const styled of Array.from(clone.querySelectorAll<HTMLElement>("[style]"))) {
    if (styled.style.display === "none") styled.remove();
  }
  for (const linebreak of Array.from(clone.querySelectorAll("br"))) {
    linebreak.replaceWith(" ");
  }
  const cells = Array.from(clone.querySelectorAll("th, td"));
  return (cells.length > 0 ? cells : [clone]).map(textOf).filter((text) => text.length > 0);
}

function splitSentences(text: string, lang: Lang): string[] {
  const pattern = lang === "ja" ? /(?<=[。！？])/ : /(?<=[.!?])\s+(?=[A-Z"'(“])/;
  return text
    .split(pattern)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
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
      const runs = textRunsOf(block);
      const minLength = block.tagName === "P" ? MIN_PROSE_LENGTH : MIN_COMPACT_LENGTH;
      if (runs.join(" ").length < minLength) continue;
      const id = `p${paragraphCount++}`;
      current.paragraphs.push({
        id,
        sentences: runs
          .flatMap((run) => splitSentences(run, fetched.lang))
          .map((sentence, position) => ({ id: `${id}.${position}`, text: sentence })),
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
  };
}

export function isLead(section: Section): boolean {
  return section.heading === LEAD_HEADING;
}

export function sectionHeading(section: Section): string {
  return isLead(section) ? "Overview" : section.heading;
}
