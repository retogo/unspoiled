import { describe, expect, it } from "vitest";
import { findEvidence } from "./search";
import { newPolicy, type Policy } from "./risk";
import type { Article, Section } from "./segment";

function section(id: string, heading: string, sentences: string[]): Section {
  return {
    id,
    heading,
    headingPath: [heading],
    level: 2,
    paragraphs: [
      {
        id: `${id}p0`,
        sentences: sentences.map((text, position) => ({
          id: `${id}p0.${position}`,
          text,
          runs: [{ kind: "text", text }],
        })),
      },
    ],
  };
}

function article(...sections: Section[]): Article {
  return {
    lang: "en",
    title: "Test",
    displayTitle: "Test",
    sourceUrl: "https://en.wikipedia.org/wiki/Test",
    sections,
    references: [],
  };
}

function policy(overrides: Partial<Policy> = {}): Policy {
  return { ...newPolicy(), ...overrides };
}

describe("findEvidence", () => {
  it("withholds the heading of a section whose heading is a spoiler", () => {
    const found = findEvidence(
      article(section("s1", "Series finale", ["The show ran for six seasons on television."])),
      policy(),
      "how many seasons",
      8,
    );

    expect(found.evidence).toHaveLength(1);
    expect(found.evidence[0].section).toBeNull();
    expect(found.evidence[0].section_withheld).toBe("the heading itself names the reveal");
    expect(found.evidence[0].text).toContain("six seasons");
  });

  it("names the section when its heading is not withheld", () => {
    const found = findEvidence(
      article(
        section("s0", "(lead)", ["The film was released in 1999 to strong reviews."]),
        section("s1", "Production", ["Filming of the movie lasted four months."]),
      ),
      policy(),
      "released filming",
      8,
    );

    expect(found.evidence.map((item) => item.section).sort()).toEqual(["Overview", "Production"]);
    expect(found.evidence.every((item) => item.section_withheld === undefined)).toBe(true);
  });

  it("names a withheld heading once the reader has revealed it", () => {
    const finale = section("s1", "Series finale", ["The show ran for six seasons on television."]);
    const found = findEvidence(article(finale), policy({ revealed: new Set(["s1.heading"]) }), "how many seasons", 8);

    expect(found.evidence[0].section).toBe("Series finale");
  });

  it("leaves withheld sentences out of the evidence and counts them", () => {
    const found = findEvidence(
      article(
        section("s1", "Cast", [
          "The cast of the movie was assembled in Philadelphia.",
          "The cast reveal the twist in a later interview.",
        ]),
      ),
      policy(),
      "cast",
      8,
    );

    expect(found.evidence.map((item) => item.text)).toEqual([
      "The cast of the movie was assembled in Philadelphia.",
    ]);
    expect(found.excluded_sentences).toBe(1);
  });

  it("matches a Japanese term that starts at an odd offset in the sentence", () => {
    const found = findEvidence(
      article(section("s1", "あらすじ", ["犯人の正体が明かされる。"])),
      newPolicy(0),
      "正体は誰？",
      8,
    );

    expect(found.evidence.map((item) => item.text)).toEqual(["犯人の正体が明かされる。"]);
  });

  it("scores a term repeated in the question once", () => {
    const found = findEvidence(
      article(section("s1", "Production", ["The movie was directed and written by the same person."])),
      policy(),
      "who directed the movie, and who wrote the movie?",
      8,
    );

    expect(found.evidence[0].score).toBe(4);
  });

  it("ranks English sentences by how many question terms they share, up to the limit", () => {
    const found = findEvidence(
      article(
        section("s1", "Production", [
          "The soundtrack was recorded in Prague.",
          "The movie was directed by a first-time director.",
          "Filming of the sequel began later.",
        ]),
      ),
      policy(),
      "who directed the movie",
      2,
    );

    expect(found.evidence).toHaveLength(2);
    expect(found.evidence[0].text).toBe("The movie was directed by a first-time director.");
    expect(found.evidence[0].score).toBeGreaterThan(found.evidence[1].score);
  });
});
