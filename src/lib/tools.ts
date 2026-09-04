import { sectionHeading, sectionHeadingPath, type Article, type Paragraph, type Section } from "./segment";
import { assessSection, hiddenSentence, maskWith, type Decision, type Policy } from "./risk";
import { countMatching, fold, type Rule, type RuleDraft } from "./rules";
import { articleKey } from "./session";
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
  /**
   * Stores these rules, puts the ones that apply to the open article in force, and hands back both
   * the rules as they were named and the policy they made, so the caller does not have to wait for
   * a re-render to report what changed.
   */
  addRules: (drafts: RuleDraft[]) => { added: Rule[]; policy: Policy };
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
 * The sentences one side of a decision names, and the ids that named nothing. An id the article
 * does not have is reported rather than thrown: the decision still stands and is still recorded,
 * and the agent is told which of its ids missed instead of losing the whole call to one typo.
 */
type Selection = { ids: string[]; unknown: string[] };

function selectSentences(article: Article, selector: unknown): Selection {
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
  const unknown: string[] = [];
  for (const id of section_ids ?? []) {
    const section = article.sections.find((candidate) => candidate.id === id);
    if (section) selected.push(...sentenceIdsIn(section));
    else unknown.push(id);
  }
  for (const id of paragraph_ids ?? []) {
    const paragraph = paragraphs.get(id);
    if (paragraph) selected.push(...paragraph.sentences.map((sentence) => sentence.id));
    else unknown.push(id);
  }
  for (const id of sentence_ids ?? []) {
    if (sentences.has(id)) selected.push(id);
    else unknown.push(id);
  }
  return { ids: [...new Set(selected)], unknown };
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
    heading: sectionHeading(section),
    heading_path: sectionHeadingPath(section),
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

/** Every sentence of the article as plain text, which is what a rule is matched against. */
function sentenceTexts(article: Article): string[] {
  return article.sections.flatMap((section) =>
    section.paragraphs.flatMap((paragraph) => paragraph.sentences.map((sentence) => sentence.text)),
  );
}

/**
 * One rule an agent asked for. A rule is the one thing an agent hands the page that the page then
 * shows the reader in the agent's own words, so the words are checked before anything is stored:
 * a rule with no phrase reaches nothing, a rule with no label or reason leaves the reader with
 * nothing to judge, and a label that repeats a phrase prints the spoiler under the mask.
 */
function asDraft(request: unknown): RuleDraft {
  const { phrases, label, reason } = (request ?? {}) as Record<string, unknown>;
  const wanted = (Array.isArray(phrases) ? phrases : [])
    .filter((phrase): phrase is string => typeof phrase === "string")
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase !== "");
  if (wanted.length === 0) throw new Error("Every rule needs at least one phrase to look for.");
  const named = typeof label === "string" ? label.trim() : "";
  if (named === "") {
    throw new Error("Every rule needs a label: it is what the reader is shown in place of the phrases.");
  }
  const why = typeof reason === "string" ? reason.trim() : "";
  if (why === "") throw new Error("Every rule needs a reason: it is shown to the reader beside the label.");
  const folded = fold(named);
  if (wanted.some((phrase) => folded.includes(fold(phrase)))) {
    throw new Error(
      "The label repeats one of the phrases, which would print the spoiler on the reader's screen. Describe what the rule covers instead, as in \"The fate of a main character\".",
    );
  }
  return { phrases: wanted, label: named, origin: "agent", reason: why };
}

/**
 * A decision as the report gives it, which is a decision minus the article it names. `Omit` over a
 * union would keep only the fields both kinds share, so the two kinds are narrowed one at a time.
 */
type ReportedDecision = Decision extends infer D
  ? D extends Decision
    ? Omit<D, "articleKey" | "articleTitle">
    : never
  : never;

/**
 * The decisions that shaped the article the reader has open. The log itself spans the session, but
 * a report of this page would mislead by listing decisions whose ids belong to another article; the
 * article each one was made on is dropped with them, since every row that is left names this one.
 */
function decisionsOn(policy: Policy, key: string): ReportedDecision[] {
  return policy.decisions
    .filter((decision) => decision.articleKey === key)
    .map((decision) =>
      decision.kind === "mask"
        ? { kind: decision.kind, at: decision.at, show: decision.show, hide: decision.hide, reason: decision.reason }
        : { kind: decision.kind, at: decision.at, label: decision.label, reason: decision.reason },
    );
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
        "Open a Wikipedia article in the reader and wait until it is on screen, or call it with no arguments to describe the article already open. Returns the outline: every section with its heading, how many sentences it holds and how many of them the reader is currently being shown. The lead section has no heading in the article and is reported as \"Lead section\". No article text — call read_article_content next for that. The ids in the outline belong to this article only.",
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
        "Read the article in full, spoilers included, with an id on every sentence. Reading the ending is the job, not a mistake: you read it so the reader does not have to, then call apply_mask to decide which sentences reach their screen. `shown` says whether each sentence is on that screen now. Do not repeat what you read here in your reply — the reader is reading this article precisely because they do not want to be told how it ends. The lead section is reported as \"Lead section\", as in open_article. The sections you read are listed on their screen for the rest of the session.",
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
            heading: sectionHeading(section),
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
        "Decide what this reader sees, and have the page enforce it sentence by sentence. Name whole sections, whole paragraphs or single sentences on either side: `show` puts text on their screen that the page was withholding, `hide` takes down text the page's wording rules let through — 'his mother is eaten by a Titan' carries no giveaway words. Your decision outranks those rules in both directions, and hiding beats showing where a sentence is named on both. Spend what you know about this reader: someone who finished season 1 can be shown the season 1 sections, someone who stopped halfway through a plot can be shown its opening paragraphs and no more. The reason is required and is displayed to them beside the count, so write it in their terms and call this once per decision rather than once per sentence. Every call is recorded on their screen, including one that reached nothing: `matched` says how many sentences each side actually moved and `unknown_ids` lists the ids that named nothing, so check both rather than assuming the mask took. Call get_masking_report afterwards to see the page as they now see it.",
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
        const hidden = selectSentences(article, input.hide);
        const shown = selectSentences(article, input.show);
        const hide = hidden.ids;
        /* Hiding wins, so a sentence named on both sides was never shown: the record says so. */
        const show = shown.ids.filter((id) => !hide.includes(id));
        const policy = context.policy();
        const masked = maskWith(policy, show, hide);
        /* Every call is recorded, a call that reached nothing included: a decision the reader
           cannot see is a decision they cannot disagree with. */
        const next: Policy = {
          ...masked,
          decisions: [
            ...policy.decisions,
            {
              kind: "mask",
              at: Date.now(),
              articleKey: articleKey(article.lang, article.title),
              articleTitle: article.displayTitle,
              show,
              hide,
              reason,
            },
          ],
        };
        context.setPolicy(next);
        return {
          show,
          hide,
          reason,
          matched: { shown: show.length, hidden: hide.length },
          unknown_ids: [...new Set([...shown.unknown, ...hidden.unknown])],
          sentences: countSentences(article, next),
        };
      },
    },
    {
      name: "add_rules",
      description:
        "Add a standing rule: every sentence carrying one of `phrases` comes off the reader's screen, wherever it appears, in every article they open, at every sensitivity including the one that withholds nothing else, and in later sessions — a rule is kept on their device until they take it down. So add one for something they never want to meet again rather than for one page: a character whose fate they do not want, a name they have asked you never to mention, anything past where they have watched or read. Matching is literal and case-insensitive, so give the phrase in the form the article uses it and add the variants beside it. `label` is what the reader is shown in place of the phrases and MUST be safe for them to read: a description of the ground the rule covers, never the phrases reworded and never the name or the event. \"The fate of a main character\" and \"Developments after volume 30\" are labels; \"Levi dies\" is not, and a label that repeats one of its own phrases fails the call. `reason` is why you added it and is shown beside the label. They see the label, how many sentences of the article in front of them it reached and your reason, and can uncover the phrases or take the rule down; nothing here removes one, so ask them if they should. Call get_masking_report afterwards for what the page is now withholding.",
      inputSchema: {
        type: "object",
        properties: {
          rules: {
            type: "array",
            items: {
              type: "object",
              properties: {
                phrases: {
                  type: "array",
                  items: { type: "string" },
                  description: "Literal phrases, as the article writes them. Any one of them withholds the sentence.",
                },
                label: {
                  type: "string",
                  description:
                    "What the reader is shown instead of the phrases. Say what the rule covers, not what it hides.",
                },
                reason: { type: "string", description: "Why this reader wants this hidden. Shown on their screen." },
              },
              required: ["phrases", "label", "reason"],
              additionalProperties: false,
            },
          },
        },
        required: ["rules"],
        additionalProperties: false,
      },
      /* The arguments carry the phrases, and every call is displayed: the reader sees the labels. */
      summariseInput: (input) => {
        const rules = Array.isArray(input.rules) ? input.rules : [];
        const labels = rules.map((rule) => String((rule as { label?: unknown }).label ?? "a rule"));
        return labels.length > 0 ? labels.join(", ") : "no rules";
      },
      execute: (input) => {
        const article = requireArticle(context);
        const requested = Array.isArray(input.rules) ? input.rules : [];
        if (requested.length === 0) throw new Error("Name at least one rule to add.");
        /* Every rule of the call is checked before any of it is stored: a call the reader would be
           shown a spoiler for is refused whole, rather than half applied. */
        const drafts = requested.map(asDraft);
        const { added, policy } = context.addRules(drafts);
        const texts = sentenceTexts(article);
        return {
          added: added.map((rule) => ({
            id: rule.id,
            label: rule.label,
            matched_sentences: countMatching(rule, texts),
          })),
          sentences: countSentences(article, policy),
        };
      },
    },
    {
      name: "get_masking_report",
      description:
        "Audit what the reader is looking at: how many sentences are on their screen and how many are withheld, every standing rule by its label and how many sentences of this article it reaches, everything apply_mask and add_rules have done and the reason you gave for each, and which sections read_article_content has read. No article text and no rule phrases, so this is safe to summarise back to the reader — it is how you tell them what you withheld without telling them what was in it.",
      inputSchema: noInput,
      execute: () => {
        const article = requireArticle(context);
        const policy = context.policy();
        const texts = sentenceTexts(article);
        return {
          sensitivity: policy.sensitivity,
          sentences: countSentences(article, policy),
          /* By label, never by phrase: this report is the one the agent reads back to the reader. */
          rules: policy.rules.map((rule) => ({
            id: rule.id,
            label: rule.label,
            origin: rule.origin,
            matched_sentences: countMatching(rule, texts),
          })),
          decisions: decisionsOn(policy, articleKey(article.lang, article.title)),
          sections_read: context.scanned(),
        };
      },
    },
  ];
}
