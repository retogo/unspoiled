import type { Article, Section, Sentence } from "./segment";
import { isLead, sectionHeading } from "./segment";

export type RiskLevel = "safe" | "suspect" | "spoiler";

export type Assessment = {
  level: RiskLevel;
  reason: string;
};

const NARRATIVE_SECTIONS =
  /^(plot|synopsis|story|storyline|plot summary|summary|ending|episodes?|episode list|characters?|あらすじ|ストーリー|物語|各話|エピソード|結末|登場人物)/i;

const ANALYSIS_SECTIONS =
  /^(themes?|analysis|interpretation|symbolism|meaning|influences?|テーマ|考察|解釈|作品分析)/i;

const META_SECTIONS =
  /^(production|development|casting|filming|music|release|home media|reception|box office|critical response|accolades|awards|legacy|references|external links|see also|製作|制作|公開|評価|受賞|脚注|関連項目|外部リンク|キャスト)/i;

const REVEAL_MARKERS =
  /\btwist|\breveal|\bbetray|\bresurrect|\bactually\b|\bturns out\b|\bin the end\b|\bfinale\b|\bfinal (scene|episode|act)\b|\bdies\b|\bdeath of\b|\bis killed\b|\bthe killer\b|\bmurderer\b|\bending\b|\bclimax\b|\bepilogue\b|実は|正体|結末|最終回|最後に|死ぬ|殺され|裏切/i

export function assessSection(section: Section): Assessment {
  if (NARRATIVE_SECTIONS.test(section.heading)) {
    return { level: "spoiler", reason: `narrative section "${section.heading}"` };
  }
  if (ANALYSIS_SECTIONS.test(section.heading)) {
    return { level: "spoiler", reason: `analysis section "${section.heading}" discusses the ending` };
  }
  if (isLead(section)) {
    return { level: "safe", reason: "lead section, checked sentence by sentence" };
  }
  if (META_SECTIONS.test(section.heading)) {
    return { level: "safe", reason: `production/publication section "${section.heading}"` };
  }
  return { level: "safe", reason: `section "${section.heading}", checked sentence by sentence` };
}

export function assessHeading(section: Section): Assessment | null {
  if (isLead(section)) return null;
  if (REVEAL_MARKERS.test(section.heading)) {
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
  if (REVEAL_MARKERS.test(sentence.text)) {
    return { level: "suspect", reason: `reveal wording inside "${sectionHeading(section)}"` };
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

export function isHidden(assessment: Assessment, policy: Policy, sentenceId: string): boolean {
  if (policy.revealed.includes(sentenceId)) return false;
  if (policy.level === "open") return false;
  if (policy.level === "balanced") return assessment.level === "spoiler";
  return assessment.level !== "safe";
}

export function isSectionKnown(policy: Policy, sectionId: string): string | null {
  return policy.knownSections.find((known) => known.sectionId === sectionId)?.because ?? null;
}

export function hiddenSentence(sentence: Sentence, section: Section, policy: Policy): boolean {
  if (policy.revealed.includes(sentence.id)) return false;
  if (policy.withheld.includes(sentence.id)) return true;
  if (isSectionKnown(policy, section.id)) return false;
  return isHidden(assessSentence(sentence, section), policy, sentence.id);
}

export function hiddenHeading(section: Section, policy: Policy): Assessment | null {
  const assessment = assessHeading(section);
  if (!assessment) return null;
  if (policy.level === "open") return null;
  if (policy.revealed.includes(headingId(section))) return null;
  if (isSectionKnown(policy, section.id)) return null;
  return assessment;
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
