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

    for (const paragraph of Array.from(element.matches("p") ? [element] : element.querySelectorAll("p"))) {
      const text = (paragraph.textContent ?? "").replace(/\[\d+\]/g, "").replace(/\s+/g, " ").trim();
      if (text.length < 40) continue;
      const id = `p${paragraphCount++}`;
      current.paragraphs.push({
        id,
        sentences: splitSentences(text, fetched.lang).map((sentence, position) => ({
          id: `${id}.${position}`,
          text: sentence,
        })),
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
