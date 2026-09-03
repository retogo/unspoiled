import type { Article, Paragraph, Section } from "./segment";
import { assessSection, hiddenSentence, maskWith, type Policy } from "./risk";
import type { ToolDefinition } from "./webmcp";
import type { Lang } from "./wikipedia";

/**
 * Opening an article is asynchronous, so the outcome is reported back rather
 * than assumed: the article that was actually fetched, together with the policy
 * that now applies to it, so a caller does not have to wait for a re-render to
 * describe it.
 */
export type OpenResult =
  | { status: "opened"; article: Article; policy: Policy }
  | { status: "superseded" }
  | { status: "failed"; error: string };

export type ToolContext = {
  article: () => Article | null;
  policy: () => Policy;
  setPolicy: (next: Policy) => void;
  openArticle: (lang: Lang, title: string) => Promise<OpenResult>;
  scanned: () => string[];
  markScanned: (article: Article, sectionIds: string[]) => void;
};

const noInput = { type: "object", properties: {}, additionalProperties: false };

/** What `apply_mask` takes on each side: whole sections, whole paragraphs, or single sentences. */
const selection = {
  type: "object",
  properties: {
    section_ids: { type: "array", items: { type: "string" } },
    paragraph_ids: { type: "array", items: { type: "string" } },
    sentence_ids: { type: "array", items: { type: "string" } },
  },
  additionalProperties: false,
};

function requireArticle(context: ToolContext): Article {
  const article = context.article();
  if (!article) throw new Error("No article is open. Call open_article with a title first.");
  return article;
}

function sentenceIdsIn(section: Section): string[] {
  return section.paragraphs.flatMap((paragraph) => paragraph.sentences.map((sentence) => sentence.id));
}

function sectionsNamed(article: Article, ids: unknown): Section[] {
  if (ids === undefined) return article.sections;
  const wanted = ids as string[];
  return wanted.map((id) => {
    const section = article.sections.find((candidate) => candidate.id === id);
    if (!section) throw new Error(`Unknown section_id: ${id}. Call open_article for the ids of this article.`);
    return section;
  });
}

/**
 * An id the article does not have is refused rather than skipped: a decision that silently reached
 * nothing would leave the agent believing it had masked something, and the reader looking at text
 * their agent thinks is hidden.
 */
function selectedSentences(article: Article, selector: unknown): string[] {
  const { section_ids, paragraph_ids, sentence_ids } = (selector ?? {}) as {
    section_ids?: string[];
    paragraph_ids?: string[];
    sentence_ids?: string[];
  };
  const paragraphs = new Map<string, Paragraph>();
  const sentences = new Set<string>();
  for (const section of article.sections) {
    for (const paragraph of section.paragraphs) {
      paragraphs.set(paragraph.id, paragraph);
      for (const sentence of paragraph.sentences) sentences.add(sentence.id);
    }
  }

  const selected: string[] = [];
  for (const section of sectionsNamed(article, section_ids ?? [])) selected.push(...sentenceIdsIn(section));
  for (const id of paragraph_ids ?? []) {
    const paragraph = paragraphs.get(id);
    if (!paragraph) throw new Error(`Unknown paragraph_id: ${id}. Call open_article for the ids of this article.`);
    selected.push(...paragraph.sentences.map((sentence) => sentence.id));
  }
  for (const id of sentence_ids ?? []) {
    if (!sentences.has(id)) {
      throw new Error(`Unknown sentence_id: ${id}. Call read_article_content for the ids of this article.`);
    }
    selected.push(id);
  }
  return [...new Set(selected)];
}

function outlineSection(section: Section, policy: Policy) {
  const sentences = sentenceIdsIn(section);
  let withheld = 0;
  for (const paragraph of section.paragraphs) {
    for (const sentence of paragraph.sentences) {
      if (hiddenSentence(sentence, section, policy)) withheld += 1;
    }
  }
  return {
    section_id: section.id,
    heading: section.heading,
    heading_path: section.headingPath,
    risk: assessSection(section).level,
    sentences: sentences.length,
    withheld,
    paragraph_ids: section.paragraphs.map((paragraph) => paragraph.id),
  };
}

function outline(article: Article, policy: Policy) {
  return {
    title: article.displayTitle,
    lang: article.lang,
    source_url: article.sourceUrl,
    sections: article.sections.map((section) => outlineSection(section, policy)),
  };
}

function countSentences(article: Article, policy: Policy) {
  let total = 0;
  let hidden = 0;
  for (const section of article.sections) {
    for (const paragraph of section.paragraphs) {
      for (const sentence of paragraph.sentences) {
        total += 1;
        if (hiddenSentence(sentence, section, policy)) hidden += 1;
      }
    }
  }
  return { total, shown: total - hidden, hidden };
}

export function buildTools(context: ToolContext): ToolDefinition[] {
  return [
    {
      name: "open_article",
      description:
        "Open a Wikipedia article in the reader and wait until it is on screen, or call it with no arguments to describe the article already open. Returns the outline: every section with its heading, how many sentences it holds and how many of them the reader is currently being shown. No article text — call read_article_content next for that. The ids in the outline belong to this article only.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Leave out to describe the article already on screen." },
          lang: { type: "string", enum: ["en", "ja"] },
        },
        additionalProperties: false,
      },
      execute: async (input) => {
        if (input.title === undefined) {
          const article = requireArticle(context);
          return outline(article, context.policy());
        }
        const result = await context.openArticle((input.lang as Lang) ?? "en", String(input.title));
        if (result.status === "failed") throw new Error(result.error);
        if (result.status === "superseded") {
          return {
            superseded: true,
            message: "A later open_article replaced this one. The reader is looking at that article instead.",
          };
        }
        return outline(result.article, result.policy);
      },
    },
    {
      name: "read_article_content",
      description:
        "Read the article in full, spoilers included, with an id on every sentence. Reading the ending is the job, not a mistake: you read it so the reader does not have to, then call apply_mask to decide which sentences reach their screen. `shown` says whether each sentence is on that screen now. Do not repeat what you read here in your reply — the reader is reading this article precisely because they do not want to be told how it ends. The sections you read are listed on their screen for the rest of the session.",
      inputSchema: {
        type: "object",
        properties: {
          section_ids: {
            type: "array",
            items: { type: "string" },
            description: "Section ids from open_article. Leave out to read the whole article.",
          },
        },
        additionalProperties: false,
      },
      execute: (input) => {
        const article = requireArticle(context);
        const policy = context.policy();
        const sections = sectionsNamed(article, input.section_ids);
        context.markScanned(
          article,
          sections.map((section) => section.id),
        );
        return {
          sections: sections.map((section) => ({
            section_id: section.id,
            heading: section.heading,
            paragraphs: section.paragraphs.map((paragraph) => ({
              paragraph_id: paragraph.id,
              sentences: paragraph.sentences.map((sentence) => ({
                sentence_id: sentence.id,
                text: sentence.text,
                shown: !hiddenSentence(sentence, section, policy),
              })),
            })),
          })),
        };
      },
    },
    {
      name: "apply_mask",
      description:
        "Decide what this reader sees, and have the page enforce it sentence by sentence. Name whole sections, whole paragraphs or single sentences on either side: `show` puts text on their screen that the page was withholding, `hide` takes down text the page's wording rules let through — 'his mother is eaten by a Titan' carries no giveaway words. Your decision outranks those rules in both directions, and hiding beats showing where a sentence is named on both. Spend what you know about this reader: someone who finished season 1 can be shown the season 1 sections, someone who stopped halfway through a plot can be shown its opening paragraphs and no more. The reason is required and is displayed to them beside the count, so write it in their terms and call this once per decision rather than once per sentence. Call get_masking_report afterwards to see the page as they now see it.",
      inputSchema: {
        type: "object",
        properties: {
          show: selection,
          hide: selection,
          reason: {
            type: "string",
            description: "Why this reader can see, or must not see, what this call names. Shown on their screen.",
          },
        },
        required: ["reason"],
        additionalProperties: false,
      },
      execute: (input) => {
        const article = requireArticle(context);
        const reason = typeof input.reason === "string" ? input.reason.trim() : "";
        if (reason === "") throw new Error("A reason is required: it is shown to the reader beside what you masked.");
        const show = selectedSentences(article, input.show);
        const hide = selectedSentences(article, input.hide);
        const policy = context.policy();
        const masked = maskWith(policy, show, hide);
        const next: Policy = {
          ...masked,
          decisions: [...policy.decisions, { at: Date.now(), show, hide, reason }],
        };
        context.setPolicy(next);
        return { show, hide, reason, sentences: countSentences(article, next) };
      },
    },
    {
      name: "get_masking_report",
      description:
        "Audit what the reader is looking at: how many sentences are on their screen and how many are withheld, every decision apply_mask has made and the reason you gave for it, and which sections read_article_content has read. No article text, so this is safe to summarise back to the reader — it is how you tell them what you withheld without telling them what was in it.",
      inputSchema: noInput,
      execute: () => {
        const article = requireArticle(context);
        const policy = context.policy();
        return {
          sensitivity: policy.sensitivity,
          sentences: countSentences(article, policy),
          decisions: policy.decisions,
          sections_read: context.scanned(),
        };
      },
    },
  ];
}
