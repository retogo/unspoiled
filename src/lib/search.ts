import type { Article, Section, Sentence } from "./segment";
import { sectionHeading } from "./segment";
import { hiddenHeading, hiddenSentence, type Policy } from "./risk";

export type Evidence = {
  sentence_id: string;
  section: string | null;
  section_withheld?: string;
  text: string;
  score: number;
};

/** Sliding bigrams, so a term is found wherever it starts rather than only at even offsets. */
function bigrams(text: string): string[] {
  const grams: string[] = [];
  for (const run of text.match(/[぀-ヿ一-鿿]+/g) ?? []) {
    for (let start = 0; start + 2 <= run.length; start += 1) {
      grams.push(run.slice(start, start + 2));
    }
  }
  return grams;
}

function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  return [...words.filter((word) => word.length > 2), ...bigrams(text)];
}

function score(question: Set<string>, sentence: Sentence): number {
  const terms = new Set(tokenize(sentence.text));
  let total = 0;
  for (const term of question) {
    if (terms.has(term)) total += 1;
  }
  return total;
}

export function findEvidence(article: Article, policy: Policy, question: string, limit: number) {
  const terms = new Set(tokenize(question));
  const evidence: Evidence[] = [];
  let excluded = 0;

  const visit = (section: Section) => {
    const withheldHeading = hiddenHeading(section, policy);
    for (const paragraph of section.paragraphs) {
      for (const sentence of paragraph.sentences) {
        if (hiddenSentence(sentence, section, policy)) {
          excluded += 1;
          continue;
        }
        const relevance = score(terms, sentence);
        if (relevance === 0) continue;
        evidence.push({
          sentence_id: sentence.id,
          section: withheldHeading ? null : sectionHeading(section),
          section_withheld: withheldHeading?.reason,
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
