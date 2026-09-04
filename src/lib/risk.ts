import { strongestCategory, type SpoilerCategory } from "./categories";
import { matchingRule, type Rule, type RuleOrigin, type RuleScope } from "./rules";
import type { Article, Section, Sentence } from "./segment";
import { isLead } from "./segment";

export type RiskLevel = "safe" | "suspect" | "spoiler";

/**
 * `risk` is how much of the ending this text gives away, from 0 to 100. It is compared against the
 * reader's threshold; `level` and `reason` say the same thing in words, for the screen and for the
 * agent. `category` is the kind of spoiler the wording carries, where the wording is what decided
 * the score, and is the page's own bookkeeping: no tool reports it and no placeholder shows it.
 */
export type Assessment = {
  level: RiskLevel;
  risk: number;
  reason: string;
  category?: SpoilerCategory;
};

const CERTAIN = 100;
const NARRATIVE_OPENING = 40;
const ANALYSIS = 70;
/**
 * A section the heading rules can neither call narrative nor vouch for as production or
 * publication, and the lead, which is where an article states the ending in passing. Neither is
 * withheld until the reader asks for the most protection there is.
 */
const UNVOUCHED = 20;
const NOTHING = 0;

/**
 * The lowest weight any kind of spoiler carries. Anything at or above it states something about
 * the story; anything below it only leans that way, which is what "suspect" is for.
 */
const SPOILER = 55;

function levelFor(risk: number): RiskLevel {
  if (risk === NOTHING) return "safe";
  return risk < SPOILER ? "suspect" : "spoiler";
}

const HEADING_TAIL = String.raw`(?:\s*[([:：（〔・\-–—/].*)?$`;

function headingRule(alternatives: string): RegExp {
  return new RegExp(`^(?:${alternatives})(?:一覧)?${HEADING_TAIL}`, "i");
}

const NARRATIVE_SECTIONS = headingRule(
  "plot|plot summary|synopsis|story|storyline|summary|ending|endings|episodes?|episode list|list of episodes|characters?|character list|あらすじ|ストーリー|物語|各話|各話あらすじ|エピソード|結末|登場人物",
);

const ANALYSIS_SECTIONS = headingRule(
  "themes?|analysis|interpretations?|symbolism|meaning|influences?|テーマ|考察|解釈|作品分析",
);

const META_SECTIONS = headingRule(
  "production|development|casting|filming|music|soundtrack|release|home media|reception|box office|critical response|critical reception|accolades|awards|legacy|references|external links|see also|製作|制作|公開|評価|受賞|脚注|関連項目|外部リンク|キャスト|主題歌",
);

function isNarrative(section: Section): boolean {
  return section.headingPath.some((heading) => NARRATIVE_SECTIONS.test(heading));
}

function isAnalysis(section: Section): boolean {
  return section.headingPath.some((heading) => ANALYSIS_SECTIONS.test(heading));
}

export function assessSection(section: Section): Assessment {
  if (isNarrative(section)) {
    return { level: "spoiler", risk: CERTAIN, reason: "plot summaries state the ending" };
  }
  if (isAnalysis(section)) {
    return { level: "spoiler", risk: ANALYSIS, reason: "analysis sections discuss the ending" };
  }
  if (isLead(section)) {
    return { level: levelFor(UNVOUCHED), risk: UNVOUCHED, reason: "the lead, which sums up the ending too" };
  }
  if (META_SECTIONS.test(section.heading)) {
    return { level: "safe", risk: NOTHING, reason: "a production or publication section" };
  }
  return { level: levelFor(UNVOUCHED), risk: UNVOUCHED, reason: "a section the page cannot vouch for" };
}

/**
 * A plot summary runs in the order the story does, so a sentence is scored by how far into the
 * section it sits: the opening is the safest thing in it and the last sentence is the ending. That
 * is what lets the reader lower their threshold and have the story open from the front, and the
 * span it runs over is what gives the named points on the scale something to divide.
 */
function baseline(section: Section, position: number, count: number): Assessment {
  if (isNarrative(section)) {
    const through = count > 1 ? position / (count - 1) : 1;
    const risk = Math.round(NARRATIVE_OPENING + (CERTAIN - NARRATIVE_OPENING) * through);
    return { level: levelFor(risk), risk, reason: "plot summaries state the ending" };
  }
  return assessSection(section);
}

/**
 * A sentence is worth whichever gives more away: where it sits in its section, or the kind of
 * spoiler its own wording carries. Taking the higher of the two is what lets a death in a
 * production section be withheld while the opening line of a plot summary is not.
 */
function assessAll(section: Section): Map<string, Assessment> {
  const sentences = section.paragraphs.flatMap((paragraph) => paragraph.sentences);
  return new Map(
    sentences.map((sentence, position) => {
      const base = baseline(section, position, sentences.length);
      const wording = strongestCategory(sentence.text);
      if (!wording || wording.weight <= base.risk) return [sentence.id, base];
      return [
        sentence.id,
        {
          level: levelFor(wording.weight),
          risk: wording.weight,
          reason: wording.reason,
          category: wording.category,
        },
      ];
    }),
  );
}

/**
 * Scoring a section is the only work that touches every sentence, and nothing about it depends on
 * the reader, so it is done once per section and reused. Moving the slider then costs one lookup
 * and one comparison per sentence.
 */
const scored = new WeakMap<Section, Map<string, Assessment>>();

export function assessSentences(section: Section): ReadonlyMap<string, Assessment> {
  const cached = scored.get(section);
  if (cached) return cached;
  const assessments = assessAll(section);
  scored.set(section, assessments);
  return assessments;
}

/**
 * What every decision carries, whichever tool made it: when it was made, why, and the article it
 * was made on. The log outlives the article, and the ids and counts in it do not, so a decision
 * the reader scrolls back to is named with the article it belongs to.
 */
type DecisionMade = {
  at: number;
  articleKey: string;
  articleTitle: string;
  reason: string;
};

/**
 * One call of `apply_mask`: what it opened, what it closed, and the reason the agent gave for
 * doing so. The ids are the sentences the call actually reached, so the reader sees the size of a
 * decision as well as its wording.
 */
export type MaskDecision = DecisionMade & {
  kind: "mask";
  show: string[];
  hide: string[];
};

/**
 * One rule the agent added, in the words it is willing to have the reader read. The phrases are
 * not here: the record is on the reader's screen, and the phrase an agent picks to catch a spoiler
 * is very often the spoiler.
 */
export type RuleDecision = DecisionMade & {
  kind: "rule";
  label: string;
  scope: RuleScope;
};

/** Everything the agent has done to this page, in the order it did it. */
export type Decision = MaskDecision | RuleDecision;

export type Policy = {
  /** 0 withholds nothing; 100 withholds anything carrying the least suspicion. */
  sensitivity: number;
  /** Sentences a decision opened, whatever the wording rules make of them. */
  shown: Set<string>;
  /** Sentences a decision closed. Hiding beats showing, and both beat the wording rules. */
  hidden: Set<string>;
  /**
   * Phrases the reader, or their agent, said to withhold wherever they appear. They outrank the
   * wording rules and the slider, and are outranked by anything either party said about a sentence
   * in particular.
   */
  rules: Rule[];
  decisions: Decision[];
};

export const DEFAULT_SENSITIVITY = 65;

export function newPolicy(sensitivity: number = DEFAULT_SENSITIVITY, rules: Rule[] = []): Policy {
  return { sensitivity, shown: new Set(), hidden: new Set(), rules, decisions: [] };
}

/**
 * A sentence belongs to one side or the other, never both: naming it takes it out of the set it
 * was in. That is what lets a decision be undone — by the agent's next call, or by the reader
 * tapping the sentence — instead of accumulating into a state neither can reach past.
 */
export function maskWith(policy: Policy, show: string[], hide: string[]): Policy {
  const shown = new Set(policy.shown);
  const hidden = new Set(policy.hidden);
  for (const id of show) {
    hidden.delete(id);
    shown.add(id);
  }
  for (const id of hide) {
    shown.delete(id);
    hidden.add(id);
  }
  return { ...policy, shown, hidden };
}

/**
 * The agent's own rules, written into the record the reader reads. A rule the reader made is
 * theirs and is not a decision made for them, so it is not recorded here. An agent can only add a
 * rule with an article open, which is the article the record names it against.
 */
export function ruleDecisions(
  rules: readonly Rule[],
  at: number,
  on: { articleKey: string; articleTitle: string },
): RuleDecision[] {
  return rules.flatMap((rule) =>
    rule.origin === "agent"
      ? [{ kind: "rule" as const, at, ...on, label: rule.label, scope: rule.scope, reason: rule.reason }]
      : [],
  );
}

const HIDDEN_BY_DECISION: Assessment = {
  level: "spoiler",
  risk: CERTAIN,
  reason: "withheld by a decision on this page",
};

/**
 * A rule says nothing about which sentence it will reach, so the reader is told whose rule caught
 * this one and no more: the phrase itself can be the spoiler, and so can the label an agent gave it.
 */
const HIDDEN_BY_RULE: Record<RuleOrigin, Assessment> = {
  reader: { level: "spoiler", risk: CERTAIN, reason: "matches one of your rules" },
  agent: { level: "spoiler", risk: CERTAIN, reason: "matches a rule your agent added" },
};

/**
 * What decides whether a sentence shows, in order. A decision about this sentence outranks
 * everything, in both directions: an agent that has read the article can open what the page
 * over-withheld and close what it missed, and a tap does the same for the reader. A standing rule
 * comes next, and holds at every sensitivity — a reader who never wants to see a name does not want
 * to see it at zero either. The slider is the page's own judgement and decides the rest.
 */
export function hiddenSentenceReason(sentence: Sentence, section: Section, policy: Policy): Assessment | null {
  if (policy.hidden.has(sentence.id)) return HIDDEN_BY_DECISION;
  if (policy.shown.has(sentence.id)) return null;
  const rule = matchingRule(sentence.text, policy.rules);
  if (rule) return HIDDEN_BY_RULE[rule.origin];
  const assessment = assessSentences(section).get(sentence.id);
  if (!assessment) return null;
  return assessment.risk > CERTAIN - policy.sensitivity ? assessment : null;
}

export function hiddenSentence(sentence: Sentence, section: Section, policy: Policy): boolean {
  return hiddenSentenceReason(sentence, section, policy) !== null;
}

export function countHidden(article: Article, policy: Policy): { hidden: number; total: number } {
  let hidden = 0;
  let total = 0;
  for (const section of article.sections) {
    for (const paragraph of section.paragraphs) {
      for (const sentence of paragraph.sentences) {
        total += 1;
        if (hiddenSentence(sentence, section, policy)) hidden += 1;
      }
    }
  }
  return { hidden, total };
}

export function countHiddenIn(section: Section, policy: Policy): number {
  let hidden = 0;
  for (const paragraph of section.paragraphs) {
    for (const sentence of paragraph.sentences) {
      if (hiddenSentence(sentence, section, policy)) hidden += 1;
    }
  }
  return hidden;
}
