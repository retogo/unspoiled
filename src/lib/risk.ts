import type { Article, Section, Sentence } from "./segment";
import { isLead } from "./segment";

export type RiskLevel = "safe" | "suspect" | "spoiler";

/**
 * `risk` is how much of the ending this text gives away, from 0 to 100. It is compared against the
 * reader's threshold; `level` and `reason` say the same thing in words, for the screen and for the
 * agent.
 */
export type Assessment = {
  level: RiskLevel;
  risk: number;
  reason: string;
};

const CERTAIN = 100;
const NARRATIVE_OPENING = 60;
const ANALYSIS = 70;
const OUTRIGHT_REVEAL = 85;
const HINT = 40;
const NOTHING = 0;

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

const STRONG_REVEAL_MARKERS =
  /\btwists?\b|\bturns out\b|\bis revealed (to|as|that)\b|\bis actually\b|\bwas actually\b|\bthe killer\b|\bthe murderer\b|\bthe culprit\b|\bfinal (scene|episode|act|twist)\b|\bdies\b|\bis killed\b|\bkills (himself|herself)\b|\bcommits suicide\b|実は|正体|真犯人|自殺|殺され|裏切/i;

const WEAK_REVEAL_MARKERS =
  /\breveal|\bbetray|\bresurrect|\bin the end\b|\bfinale\b|\bdeath of\b|\bfate of\b|\bending\b|\bclimax\b|\bepilogue\b|結末|最終回|最終話|死ぬ|死亡/i;

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
    return { level: "safe", risk: NOTHING, reason: "lead section, checked sentence by sentence" };
  }
  if (META_SECTIONS.test(section.heading)) {
    return { level: "safe", risk: NOTHING, reason: "a production or publication section" };
  }
  return { level: "safe", risk: NOTHING, reason: "checked sentence by sentence" };
}

function higher(base: Assessment, marker: Assessment): Assessment {
  return marker.risk > base.risk ? marker : base;
}

/**
 * A plot summary runs in the order the story does, so a sentence is scored by how far into the
 * section it sits: the opening is the safest thing in it and the last sentence is the ending. That
 * is what lets the reader lower their threshold and have the story open from the front.
 */
function baseline(section: Section, position: number, count: number): Assessment {
  if (isNarrative(section)) {
    const through = count > 1 ? position / (count - 1) : 1;
    return {
      level: "spoiler",
      risk: Math.round(NARRATIVE_OPENING + (CERTAIN - NARRATIVE_OPENING) * through),
      reason: "plot summaries state the ending",
    };
  }
  if (isAnalysis(section)) {
    return { level: "spoiler", risk: ANALYSIS, reason: "analysis sections discuss the ending" };
  }
  return { level: "safe", risk: NOTHING, reason: assessSection(section).reason };
}

function assessAll(section: Section): Map<string, Assessment> {
  const sentences = section.paragraphs.flatMap((paragraph) => paragraph.sentences);
  return new Map(
    sentences.map((sentence, position) => {
      const base = baseline(section, position, sentences.length);
      if (STRONG_REVEAL_MARKERS.test(sentence.text)) {
        return [
          sentence.id,
          higher(base, {
            level: "spoiler",
            risk: OUTRIGHT_REVEAL,
            reason: "a sentence that states the reveal outright",
          }),
        ];
      }
      if (WEAK_REVEAL_MARKERS.test(sentence.text)) {
        return [
          sentence.id,
          higher(base, { level: "suspect", risk: HINT, reason: "wording that hints at the ending" }),
        ];
      }
      return [sentence.id, base];
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
 * One call of `apply_mask`: what it opened, what it closed, and the reason the agent gave for
 * doing so. The ids are the sentences the call actually reached, so the reader sees the size of a
 * decision as well as its wording.
 */
export type Decision = {
  at: number;
  show: string[];
  hide: string[];
  reason: string;
};

export type Policy = {
  /** 0 withholds nothing; 100 withholds anything carrying the least suspicion. */
  sensitivity: number;
  /** Sentences a decision opened, whatever the wording rules make of them. */
  shown: Set<string>;
  /** Sentences a decision closed. Hiding beats showing, and both beat the wording rules. */
  hidden: Set<string>;
  decisions: Decision[];
};

export const DEFAULT_SENSITIVITY = 75;

export function newPolicy(sensitivity: number = DEFAULT_SENSITIVITY): Policy {
  return { sensitivity, shown: new Set(), hidden: new Set(), decisions: [] };
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

const HIDDEN_BY_DECISION: Assessment = {
  level: "spoiler",
  risk: CERTAIN,
  reason: "withheld by a decision on this page",
};

/**
 * A decision outranks the wording rules in both directions, so an agent that has read the article
 * can open what the rules over-withheld and close what they missed. The sensitivity slider is the
 * page's own judgement, and it only decides the sentences no decision has reached.
 */
export function hiddenSentenceReason(sentence: Sentence, section: Section, policy: Policy): Assessment | null {
  if (policy.hidden.has(sentence.id)) return HIDDEN_BY_DECISION;
  if (policy.shown.has(sentence.id)) return null;
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
