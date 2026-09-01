import type { Article, Section, Sentence } from "./segment";
import { sectionHeading } from "./segment";
import { assessSentence, isHidden, type Policy } from "./risk";

export type Evidence = {
  sentence_id: string;
  section: string;
  text: string;
  score: number;
};

function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  const bigrams = (text.match(/[぀-ヿ一-鿿]{2}/g) ?? []).map((pair) => pair);
  return [...words.filter((word) => word.length > 2), ...bigrams];
}

function score(question: string[], sentence: Sentence): number {
  const terms = new Set(tokenize(sentence.text));
  return question.reduce((total, term) => total + (terms.has(term) ? 1 : 0), 0);
}

export function findEvidence(article: Article, policy: Policy, question: string, limit: number) {
  const terms = tokenize(question);
  const evidence: Evidence[] = [];
  let excluded = 0;

  const visit = (section: Section) => {
    for (const paragraph of section.paragraphs) {
      for (const sentence of paragraph.sentences) {
        if (isHidden(assessSentence(sentence, section), policy, sentence.id)) {
          excluded += 1;
          continue;
        }
        const relevance = score(terms, sentence);
        if (relevance === 0) continue;
        evidence.push({
          sentence_id: sentence.id,
          section: sectionHeading(section),
          text: sentence.text,
          score: relevance,
        });
      }
    }
  };

  article.sections.forEach(visit);
  evidence.sort((left, right) => right.score - left.score);
  return { evidence: evidence.slice(0, limit), excluded_sentences: excluded };
}
