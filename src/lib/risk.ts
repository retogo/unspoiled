import type { Article, Section, Sentence } from "./segment";
import { isLead } from "./segment";

export type RiskLevel = "safe" | "suspect" | "spoiler";

export type Assessment = {
  level: RiskLevel;
  reason: string;
};

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

export function assessSection(section: Section): Assessment {
  if (NARRATIVE_SECTIONS.test(section.heading)) {
    return { level: "spoiler", reason: "plot summaries state the ending" };
  }
  if (ANALYSIS_SECTIONS.test(section.heading)) {
    return { level: "spoiler", reason: "analysis sections discuss the ending" };
  }
  if (isLead(section)) {
    return { level: "safe", reason: "lead section, checked sentence by sentence" };
  }
  if (META_SECTIONS.test(section.heading)) {
    return { level: "safe", reason: "a production or publication section" };
  }
  return { level: "safe", reason: "checked sentence by sentence" };
}

export function assessHeading(section: Section): Assessment | null {
  if (isLead(section)) return null;
  if (STRONG_REVEAL_MARKERS.test(section.heading) || WEAK_REVEAL_MARKERS.test(section.heading)) {
    return { level: "spoiler", reason: "the heading itself names the reveal" };
  }
  return null;
}

export function headingId(section: Section): string {
  return `${section.id}.heading`;
}

export function assessSentence(sentence: Sentence, section: Section): Assessment {
  const sectionAssessment = assessSection(section);
  if (sectionAssessment.level === "spoiler") {
    return sectionAssessment;
  }
  if (STRONG_REVEAL_MARKERS.test(sentence.text)) {
    return { level: "spoiler", reason: "a sentence that states the reveal outright" };
  }
  if (WEAK_REVEAL_MARKERS.test(sentence.text)) {
    return { level: "suspect", reason: "wording that hints at the ending" };
  }
  return { level: "safe", reason: sectionAssessment.reason };
}

export type Policy = {
  level: "strict" | "balanced" | "open";
  revealed: string[];
  withheld: string[];
  alreadyKnows: string[];
  knownSections: { sectionId: string; because: string }[];
  notes: string;
};

export const defaultPolicy: Policy = {
  level: "strict",
  revealed: [],
  withheld: [],
  alreadyKnows: [],
  knownSections: [],
  notes: "",
};

const WITHHELD_BY_AGENT: Assessment = {
  level: "spoiler",
  reason: "withheld at your agent's request",
};

function hiddenByLevel(assessment: Assessment, level: Policy["level"]): boolean {
  if (level === "balanced") return assessment.level === "spoiler";
  return assessment.level !== "safe";
}

export function isSectionKnown(policy: Policy, sectionId: string): string | null {
  return policy.knownSections.find((known) => known.sectionId === sectionId)?.because ?? null;
}

function shownRegardless(policy: Policy, id: string, sectionId: string): boolean {
  if (policy.level === "open") return true;
  if (policy.revealed.includes(id)) return true;
  return isSectionKnown(policy, sectionId) !== null;
}

export function hiddenSentenceReason(sentence: Sentence, section: Section, policy: Policy): Assessment | null {
  if (shownRegardless(policy, sentence.id, section.id)) return null;
  if (policy.withheld.includes(sentence.id)) return WITHHELD_BY_AGENT;
  const assessment = assessSentence(sentence, section);
  return hiddenByLevel(assessment, policy.level) ? assessment : null;
}

export function hiddenSentence(sentence: Sentence, section: Section, policy: Policy): boolean {
  return hiddenSentenceReason(sentence, section, policy) !== null;
}

export function hiddenHeading(section: Section, policy: Policy): Assessment | null {
  const id = headingId(section);
  if (shownRegardless(policy, id, section.id)) return null;
  if (policy.withheld.includes(id)) return WITHHELD_BY_AGENT;
  return assessHeading(section);
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
