import type { Article, Section } from "./segment";
import { assessSection, assessSentence, isHidden, type Policy } from "./risk";
import type { ToolDefinition } from "./webmcp";
import type { Lang } from "./wikipedia";

export type ToolContext = {
  article: () => Article | null;
  policy: () => Policy;
  setPolicy: (next: Policy) => void;
  openArticle: (lang: Lang, title: string) => void;
};

const noInput = { type: "object", properties: {}, additionalProperties: false };

function requireArticle(context: ToolContext): Article {
  const article = context.article();
  if (!article) throw new Error("No article is open. Call open_article first.");
  return article;
}

function findSection(article: Article, id: unknown): Section {
  const section = article.sections.find((candidate) => candidate.id === id);
  if (!section) throw new Error(`Unknown section_id: ${String(id)}`);
  return section;
}

function sectionSummary(section: Section, policy: Policy) {
  let visible = 0;
  let hidden = 0;
  for (const paragraph of section.paragraphs) {
    for (const sentence of paragraph.sentences) {
      if (isHidden(assessSentence(sentence, section), policy, sentence.id)) hidden += 1;
      else visible += 1;
    }
  }
  return {
    section_id: section.id,
    heading: section.heading,
    risk: assessSection(section).level,
    visible_sentences: visible,
    hidden_sentences: hidden,
  };
}

export function buildTools(context: ToolContext): ToolDefinition[] {
  return [
    {
      name: "get_article_outline",
      description:
        "List the sections of the article that is currently open, with how many sentences are visible and how many are withheld as spoilers. Returns no article text.",
      inputSchema: noInput,
      execute: () => {
        const article = requireArticle(context);
        const policy = context.policy();
        return {
          title: article.displayTitle,
          language: article.lang,
          source_url: article.sourceUrl,
          policy_level: policy.level,
          sections: article.sections.map((section) => sectionSummary(section, policy)),
        };
      },
    },
    {
      name: "get_safe_text",
      description:
        "Read one section with the spoiler sentences removed. Only text the reader has chosen to be exposed to is returned; withheld sentences appear as placeholders.",
      inputSchema: {
        type: "object",
        properties: { section_id: { type: "string", description: "Section id from get_article_outline" } },
        required: ["section_id"],
        additionalProperties: false,
      },
      execute: (input) => {
        const article = requireArticle(context);
        const policy = context.policy();
        const section = findSection(article, input.section_id);
        return {
          section_id: section.id,
          heading: section.heading,
          paragraphs: section.paragraphs.map((paragraph) =>
            paragraph.sentences.map((sentence) =>
              isHidden(assessSentence(sentence, section), policy, sentence.id)
                ? { withheld: true, sentence_id: sentence.id }
                : { withheld: false, sentence_id: sentence.id, text: sentence.text },
            ),
          ),
        };
      },
    },
    {
      name: "describe_hidden",
      description:
        "Describe what is being withheld in a section without revealing it: sentence ids, why each was withheld, and how long it is. Use this to reason about the article without learning the spoilers.",
      inputSchema: {
        type: "object",
        properties: { section_id: { type: "string" } },
        required: ["section_id"],
        additionalProperties: false,
      },
      execute: (input) => {
        const article = requireArticle(context);
        const policy = context.policy();
        const section = findSection(article, input.section_id);
        const hidden = [];
        for (const paragraph of section.paragraphs) {
          for (const sentence of paragraph.sentences) {
            const assessment = assessSentence(sentence, section);
            if (!isHidden(assessment, policy, sentence.id)) continue;
            hidden.push({
              sentence_id: sentence.id,
              risk: assessment.level,
              reason: assessment.reason,
              characters: sentence.text.length,
            });
          }
        }
        return { section_id: section.id, heading: section.heading, hidden };
      },
    },
    {
      name: "set_spoiler_policy",
      description:
        "Set how much the reader is willing to see. 'strict' withholds narrative and suspect sentences, 'balanced' withholds only confirmed spoilers, 'open' withholds nothing. Record in notes what the reader already knows (works they have seen, source material they have read) so the choice is visible to them on screen.",
      inputSchema: {
        type: "object",
        properties: {
          level: { type: "string", enum: ["strict", "balanced", "open"] },
          notes: {
            type: "string",
            description: "What the reader already knows, in their own terms. Shown on screen for them to correct.",
          },
        },
        required: ["level"],
        additionalProperties: false,
      },
      execute: (input) => {
        const policy = context.policy();
        const next: Policy = {
          level: input.level as Policy["level"],
          revealed: policy.revealed,
          notes: typeof input.notes === "string" ? input.notes : policy.notes,
        };
        context.setPolicy(next);
        return { applied: next.level, notes: next.notes };
      },
    },
    {
      name: "reveal",
      description:
        "Reveal specific withheld sentences, only when the reader has explicitly asked for them. The revealed text is shown on their screen and returned here.",
      inputSchema: {
        type: "object",
        properties: {
          sentence_ids: { type: "array", items: { type: "string" } },
        },
        required: ["sentence_ids"],
        additionalProperties: false,
      },
      execute: (input) => {
        const article = requireArticle(context);
        const policy = context.policy();
        const ids = (input.sentence_ids as string[]) ?? [];
        context.setPolicy({ ...policy, revealed: [...new Set([...policy.revealed, ...ids])] });
        const revealed = [];
        for (const section of article.sections) {
          for (const paragraph of section.paragraphs) {
            for (const sentence of paragraph.sentences) {
              if (ids.includes(sentence.id)) revealed.push({ sentence_id: sentence.id, text: sentence.text });
            }
          }
        }
        return { revealed };
      },
    },
    {
      name: "get_masking_report",
      description:
        "Report what is currently withheld across the whole article and why, so the reader can audit the filtering.",
      inputSchema: noInput,
      execute: () => {
        const article = requireArticle(context);
        const policy = context.policy();
        const sections = article.sections.map((section) => sectionSummary(section, policy));
        return {
          title: article.displayTitle,
          policy,
          total_hidden: sections.reduce((sum, section) => sum + section.hidden_sentences, 0),
          total_visible: sections.reduce((sum, section) => sum + section.visible_sentences, 0),
          sections,
        };
      },
    },
    {
      name: "open_article",
      description: "Open a Wikipedia article by title in the reader.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          language: { type: "string", enum: ["en", "ja"] },
        },
        required: ["title"],
        additionalProperties: false,
      },
      execute: (input) => {
        const lang = (input.language as Lang) ?? "en";
        const title = String(input.title);
        context.openArticle(lang, title);
        return { opening: title, language: lang };
      },
    },
  ];
}
