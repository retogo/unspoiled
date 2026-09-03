import type { Article, Section } from "./segment";
import { findEvidence } from "./search";
import {
  assessSection,
  headingId,
  hiddenHeading,
  hiddenSentence,
  hiddenSentenceReason,
  isSectionKnown,
  type Policy,
} from "./risk";
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
  markScanned: (article: Article, sectionId: string) => void;
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

/**
 * Sensitivity arrives from an agent, so it is checked here rather than trusted: a value off the
 * scale would silently reshape what the reader sees.
 */
function asSensitivity(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 100) {
    throw new Error("sensitivity must be a whole number from 0 to 100.");
  }
  return raw;
}

function policyReport(policy: Policy) {
  return {
    sensitivity: policy.sensitivity,
    revealed: [...policy.revealed],
    withheld: [...policy.withheld],
    already_knows: policy.alreadyKnows,
    known_sections: [...policy.knownSections].map(([section_id, because]) => ({ section_id, because })),
    notes: policy.notes,
  };
}

function sectionSummary(section: Section, policy: Policy) {
  let visible = 0;
  let hidden = 0;
  for (const paragraph of section.paragraphs) {
    for (const sentence of paragraph.sentences) {
      if (hiddenSentence(sentence, section, policy)) hidden += 1;
      else visible += 1;
    }
  }
  const known = isSectionKnown(policy, section.id);
  const withheldHeading = hiddenHeading(section, policy);
  return {
    section_id: section.id,
    heading: withheldHeading ? null : section.heading,
    heading_withheld: withheldHeading?.reason,
    heading_id: withheldHeading ? headingId(section) : undefined,
    risk: known ? "known-to-reader" : assessSection(section).level,
    known_because: known ?? undefined,
    visible_sentences: visible,
    hidden_sentences: hidden,
  };
}

export function buildTools(context: ToolContext): ToolDefinition[] {
  return [
    {
      name: "get_article_outline",
      description:
        "List the sections of the article that is currently open, with how many sentences are visible and how many are withheld as spoilers. Returns no article text — call get_visible_section_text on the sections the reader asked about to actually read them, and describe_withheld_content to see what is being held back.",
      inputSchema: noInput,
      execute: () => {
        const article = requireArticle(context);
        const policy = context.policy();
        return {
          title: article.displayTitle,
          language: article.lang,
          source_url: article.sourceUrl,
          sensitivity: policy.sensitivity,
          sections: article.sections.map((section) => sectionSummary(section, policy)),
        };
      },
    },
    {
      name: "get_visible_section_text",
      description:
        "Read one section as the reader currently sees it: sentences the page or you withheld appear as placeholders, not text. Wording rules miss some spoilers, so visible does not mean spoiler-free. Summarise from this text alone, and tell the reader how many sentences were withheld rather than guessing at their content.",
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
          heading: hiddenHeading(section, policy) ? null : section.heading,
          paragraphs: section.paragraphs.map((paragraph) =>
            paragraph.sentences.map((sentence) =>
              hiddenSentence(sentence, section, policy)
                ? { withheld: true, sentence_id: sentence.id }
                : { withheld: false, sentence_id: sentence.id, text: sentence.text },
            ),
          ),
        };
      },
    },
    {
      name: "describe_withheld_content",
      description:
        "Describe what is being withheld in a section without revealing it: sentence ids, why each was withheld, how long it is, and how it scored. The score is what set_spoiler_policy compares against: a sentence scoring 80 comes back on screen at sensitivity 20 or below, so you can tell the reader exactly how far to lower the slider for the part they asked about. Use this to reason about the article without learning the spoilers.",
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
        const withheldHeading = hiddenHeading(section, policy);
        const hidden = [];
        for (const paragraph of section.paragraphs) {
          for (const sentence of paragraph.sentences) {
            const assessment = hiddenSentenceReason(sentence, section, policy);
            if (!assessment) continue;
            hidden.push({
              sentence_id: sentence.id,
              risk: assessment.risk,
              reason: assessment.reason,
              characters: sentence.text.length,
            });
          }
        }
        return {
          section_id: section.id,
          heading: withheldHeading ? null : section.heading,
          heading_withheld: withheldHeading?.reason,
          heading_id: withheldHeading ? headingId(section) : undefined,
          hidden,
        };
      },
    },
    {
      name: "set_spoiler_policy",
      description:
        "Set how much of this article the reader is willing to see, and tell the page what they already know. Sensitivity runs from 0 to 100 and moves one slider on their screen: every sentence is scored for how much of the ending it gives away, and a sentence is withheld when its score is above 100 minus the sensitivity. Three points on it are marked for the reader: 0 withholds nothing at all, including what you withheld yourself; 50 withholds plot summaries and the sentences that state a reveal outright; 75 withholds wording that merely hints at the ending as well. Plot summaries are scored by how far into the section a sentence sits, so lowering the sensitivity opens a plot from its opening scene onward rather than at random. A sentence the reader revealed, or a section they have marked as already known, stays visible at every sensitivity. Fill already_knows from what you know about this particular reader — works they have watched, source novels or manga they have read, seasons they have finished — because a fact they already know is not a spoiler for them. Everything you pass here is displayed on screen for them to correct, so state it plainly rather than guessing.",
      inputSchema: {
        type: "object",
        properties: {
          sensitivity: {
            type: "integer",
            minimum: 0,
            maximum: 100,
            description: "0 withholds nothing, 50 withholds plot and outright reveals, 75 withholds hints too.",
          },
          already_knows: {
            type: "array",
            items: { type: "string" },
            description:
              "Specific things this reader has already seen or read, e.g. 'read the original manga', 'finished season 1', 'saw the 1998 original'. Leave empty if you do not know.",
          },
          notes: { type: "string", description: "Anything else about how much this reader wants to know." },
        },
        required: ["sensitivity"],
        additionalProperties: false,
      },
      execute: (input) => {
        const policy = context.policy();
        const next: Policy = {
          ...policy,
          sensitivity: asSensitivity(input.sensitivity),
          alreadyKnows: Array.isArray(input.already_knows)
            ? (input.already_knows as string[])
            : policy.alreadyKnows,
          notes: typeof input.notes === "string" ? input.notes : policy.notes,
        };
        context.setPolicy(next);
        return {
          applied: next.sensitivity,
          already_knows: next.alreadyKnows,
          shown_on_screen: true,
          hint: "Call get_article_outline next to see what is visible at this sensitivity.",
        };
      },
    },
    {
      name: "reveal_withheld_sentences",
      description:
        "Reveal specific withheld sentences, only when the reader has explicitly asked for them. Pass a heading_id from get_article_outline or describe_withheld_content to reveal a withheld heading. The text is shown on their screen and returned here — which means you have read the spoilers, so every section this opens is listed on screen next to the ones you read with read_withheld_section.",
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
        const revealed = [];
        const opened = [];
        for (const section of article.sections) {
          let readWithheldText = false;
          if (ids.includes(headingId(section))) {
            readWithheldText = hiddenHeading(section, policy) !== null;
            revealed.push({ sentence_id: headingId(section), text: section.heading });
          }
          for (const paragraph of section.paragraphs) {
            for (const sentence of paragraph.sentences) {
              if (!ids.includes(sentence.id)) continue;
              if (hiddenSentence(sentence, section, policy)) readWithheldText = true;
              revealed.push({ sentence_id: sentence.id, text: sentence.text });
            }
          }
          if (!readWithheldText) continue;
          context.markScanned(article, section.id);
          opened.push(section.id);
        }
        context.setPolicy({ ...policy, revealed: new Set([...policy.revealed, ...ids]) });
        return { revealed, listed_on_screen_as_read: opened };
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
          policy: policyReport(policy),
          sections_the_agent_has_read: context.scanned(),
          total_hidden: sections.reduce((sum, section) => sum + section.hidden_sentences, 0),
          total_visible: sections.reduce((sum, section) => sum + section.visible_sentences, 0),
          sections,
        };
      },
    },
    {
      name: "mark_sections_known",
      description:
        "Unhide whole sections that this reader has already lived through, because a fact they already know is not a spoiler for them. Map what you know about them onto the section list: someone who finished season 1 can safely read the season 1 sections, someone who read the source novel can read the plot of the adaptation. Give the reason in 'because' — it is shown next to the section on their screen so they can disagree.",
      inputSchema: {
        type: "object",
        properties: {
          section_ids: { type: "array", items: { type: "string" } },
          because: { type: "string", description: "Why this reader already knows it, in their terms." },
        },
        required: ["section_ids", "because"],
        additionalProperties: false,
      },
      execute: (input) => {
        const article = requireArticle(context);
        const policy = context.policy();
        const because = String(input.because);
        const ids = ((input.section_ids as string[]) ?? []).filter((id) =>
          article.sections.some((section) => section.id === id),
        );
        const knownSections = new Map(policy.knownSections);
        for (const sectionId of ids) knownSections.set(sectionId, because);
        context.setPolicy({ ...policy, knownSections });
        return {
          unhidden_sections: ids.map((id) => ({
            section_id: id,
            heading: article.sections.find((section) => section.id === id)?.heading,
          })),
          because,
        };
      },
    },
    {
      name: "withhold_article_content",
      description:
        "Withhold text the page's own rules did not catch. The page matches wording, so it misses a spoiler stated plainly — 'his mother is eaten by a Titan' contains no giveaway words. Use this when the reader tells you what they do not want to know, or after read_withheld_section, where you can spend your own knowledge to protect theirs: read the plot, then withhold only the sentences that give away the ending so they can safely read the rest. The reason is shown on their screen.",
      inputSchema: {
        type: "object",
        properties: {
          sentence_ids: { type: "array", items: { type: "string" } },
          section_ids: {
            type: "array",
            items: { type: "string" },
            description: "Withhold every sentence in these sections, and their headings with them.",
          },
          because: { type: "string" },
        },
        required: ["because"],
        additionalProperties: false,
      },
      execute: (input) => {
        const article = requireArticle(context);
        const policy = context.policy();
        const sectionIds = (input.section_ids as string[]) ?? [];
        const fromSections = article.sections
          .filter((section) => sectionIds.includes(section.id))
          .flatMap((section) => [
            headingId(section),
            ...section.paragraphs.flatMap((paragraph) => paragraph.sentences.map((s) => s.id)),
          ]);
        const ids = [...((input.sentence_ids as string[]) ?? []), ...fromSections];
        const revealed = new Set(policy.revealed);
        for (const id of ids) revealed.delete(id);
        context.setPolicy({
          ...policy,
          withheld: new Set([...policy.withheld, ...ids]),
          revealed,
          notes: String(input.because),
        });
        return { withheld: ids.length, because: input.because };
      },
    },
    {
      name: "reveal_section_progressively",
      description:
        "Open a withheld narrative section only up to a point. Plot summaries run in order, so a reader who stopped watching partway can safely read the beginning: reveal the first few paragraphs and leave the rest closed. Prefer this over revealing a whole section.",
      inputSchema: {
        type: "object",
        properties: {
          section_id: { type: "string" },
          paragraphs: { type: "integer", description: "How many paragraphs from the start to open." },
          because: { type: "string" },
        },
        required: ["section_id", "paragraphs"],
        additionalProperties: false,
      },
      execute: (input) => {
        const article = requireArticle(context);
        const policy = context.policy();
        const section = findSection(article, input.section_id);
        const count = Math.max(0, Number(input.paragraphs));
        const opened = section.paragraphs.slice(0, count);
        const ids = opened.flatMap((paragraph) => paragraph.sentences.map((sentence) => sentence.id));
        const withheld = new Set(policy.withheld);
        for (const id of ids) withheld.delete(id);
        context.setPolicy({ ...policy, revealed: new Set([...policy.revealed, ...ids]), withheld });
        return {
          section_id: section.id,
          paragraphs_opened: opened.length,
          paragraphs_remaining: section.paragraphs.length - opened.length,
          sentences_opened: ids.length,
          because: input.because,
        };
      },
    },
    {
      name: "ask_about_article",
      description:
        "Find sentences in the article that answer a question, drawn only from text the reader is currently allowed to see. Withheld sentences are never searched, so an answer built from this evidence cannot contain a spoiler. The count of excluded sentences is returned so you can tell the reader that something was left out.",
      inputSchema: {
        type: "object",
        properties: {
          question: { type: "string" },
          limit: { type: "integer", description: "How many sentences of evidence to return (default 8)" },
        },
        required: ["question"],
        additionalProperties: false,
      },
      execute: (input) => {
        const article = requireArticle(context);
        const limit = typeof input.limit === "number" ? input.limit : 8;
        const found = findEvidence(article, context.policy(), String(input.question), limit);
        return {
          question: input.question,
          grounded_in: "visible sentences only",
          ...found,
        };
      },
    },
    {
      name: "read_withheld_section",
      description:
        "Read a withheld section in full, including the spoilers. This is a one-way door: once you read it you know the ending, and you may leak it later in conversation. Only call this with acknowledge=true after the reader has explicitly asked you to look. The reader is shown on screen which sections you have read.",
      inputSchema: {
        type: "object",
        properties: {
          section_id: { type: "string" },
          acknowledge: {
            type: "boolean",
            description: "Set to true to confirm the reader asked you to read the withheld text.",
          },
        },
        required: ["section_id", "acknowledge"],
        additionalProperties: false,
      },
      execute: (input) => {
        const article = requireArticle(context);
        const section = findSection(article, input.section_id);
        if (input.acknowledge !== true) {
          return {
            refused: true,
            message:
              "Withheld text is not returned without acknowledge=true. Ask the reader whether they want the spoilers first.",
          };
        }
        context.markScanned(article, section.id);
        return {
          section_id: section.id,
          heading: section.heading,
          sentences: section.paragraphs.flatMap((paragraph) =>
            paragraph.sentences.map((sentence) => ({ sentence_id: sentence.id, text: sentence.text })),
          ),
        };
      },
    },
    {
      name: "open_article",
      description:
        "Open a Wikipedia article by title in the reader, and wait until it is on screen. Returns the same section list as get_article_outline, so the section ids in it are safe to use straight away. A title that does not exist returns an error rather than opening anything.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          language: { type: "string", enum: ["en", "ja"] },
        },
        required: ["title"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const lang = (input.language as Lang) ?? "en";
        const title = String(input.title);
        const result = await context.openArticle(lang, title);
        if (result.status === "failed") throw new Error(result.error);
        if (result.status === "superseded") {
          return {
            superseded: true,
            message: "A later open_article replaced this one. The reader is looking at that article instead.",
          };
        }
        return {
          title: result.article.displayTitle,
          language: result.article.lang,
          source_url: result.article.sourceUrl,
          sensitivity: result.policy.sensitivity,
          sections: result.article.sections.map((section) => sectionSummary(section, result.policy)),
        };
      },
    },
  ];
}
