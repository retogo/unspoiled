import { describe, expect, it } from "vitest";
import type { Section } from "./segment";
import {
  assessHeading,
  assessSection,
  assessSentences,
  countHidden,
  headingId,
  hiddenHeading,
  hiddenSentence,
  newPolicy,
  type Policy,
} from "./risk";

function section(heading: string, texts: string[] = ["The film was shot on location over eleven weeks."]): Section {
  return {
    id: "s1",
    heading,
    headingPath: [heading],
    level: 2,
    paragraphs: [{ id: "p0", sentences: texts.map((text, index) => ({ id: `p0.${index}`, text })) }],
  };
}

function firstSentence(target: Section) {
  return target.paragraphs[0].sentences[0];
}

function assessmentAt(target: Section, index = 0) {
  const assessment = assessSentences(target).get(`p0.${index}`);
  if (!assessment) throw new Error(`No assessment for p0.${index}`);
  return assessment;
}

function at(sensitivity: number, overrides: Partial<Policy> = {}): Policy {
  return { ...newPolicy(sensitivity), ...overrides };
}

describe("assessment reasons", () => {
  it("does not repeat the heading of a narrative section", () => {
    expect(assessSection(section("Ending")).reason).not.toContain("Ending");
  });

  it("does not repeat the heading of an analysis section", () => {
    expect(assessSection(section("Themes")).reason).not.toContain("Themes");
  });

  it("does not repeat the heading of a production section", () => {
    expect(assessSection(section("Production")).reason).not.toContain("Production");
  });

  it("does not repeat the heading of an unclassified section", () => {
    expect(assessSection(section("Merchandise")).reason).not.toContain("Merchandise");
  });

  it("does not repeat the heading when a sentence carries reveal wording", () => {
    const target = section("Series finale", ["The twist is that he had been dead the whole time."]);
    expect(assessmentAt(target).reason).not.toContain("finale");
  });
});

describe("section headings", () => {
  it.each(["Plot", "Plot summary", "Synopsis", "Ending", "Episode list", "Characters", "あらすじ", "登場人物"])(
    "treats %s as a narrative section",
    (heading) => {
      expect(assessSection(section(heading)).level).toBe("spoiler");
    },
  );

  it.each(["Plot (film)", "Plot: overview", "登場人物一覧"])("still matches %s with a qualifier", (heading) => {
    expect(assessSection(section(heading)).level).toBe("spoiler");
  });

  it.each(["Ending themes", "Storyboarding", "Character design", "Theme song", "テーマソング", "主題歌"])(
    "does not treat %s as a spoiler section",
    (heading) => {
      expect(assessSection(section(heading)).level).toBe("safe");
    },
  );
});

describe("reveal wording", () => {
  it.each([
    "Actually, filming began in 2001 on a soundstage in Los Angeles.",
    "最後に劇場公開されたのは2003年である。",
    "The film was released in 1999 and became a sleeper hit.",
  ])("leaves %s alone", (text) => {
    const target = section("Release", [text]);
    expect(assessmentAt(target).level).toBe("safe");
    expect(assessmentAt(target).risk).toBe(0);
  });
});

describe("how a sentence is scored", () => {
  it("opens a plot summary from the front: the first sentence scores lowest, the last scores highest", () => {
    const plot = section("Plot", [
      "A boy who sees ghosts meets a child psychologist.",
      "They meet again through the winter.",
      "The boy tells his mother what he sees.",
      "The psychologist goes home for the last time.",
      "He accepts what has happened and moves on.",
    ]);
    const scores = [0, 1, 2, 3, 4].map((index) => assessmentAt(plot, index).risk);
    expect(scores).toEqual([60, 70, 80, 90, 100]);
  });

  it("scores a plot section of one sentence as the ending itself", () => {
    const plot = section("Plot", ["A boy who sees ghosts meets a child psychologist."]);
    expect(assessmentAt(plot).risk).toBe(100);
  });

  it("scores every sentence of an analysis section alike", () => {
    const themes = section("Themes", [
      "Critics read the film as a study of grief.",
      "Others place it in a longer tradition of ghost stories.",
    ]);
    expect(assessmentAt(themes, 0).risk).toBe(70);
    expect(assessmentAt(themes, 1).risk).toBe(70);
  });

  it("scores a sentence that states the reveal outright as a near certainty", () => {
    const target = section("Reception", ["Reviewers dwelt on the twist, that the narrator and Tyler are one man."]);
    expect(assessmentAt(target)).toMatchObject({ level: "spoiler", risk: 85 });
  });

  it("scores a weaker hint well below an outright reveal", () => {
    const target = section("Reception", ["Reviewers praised the ending as the strongest part of the film."]);
    expect(assessmentAt(target)).toMatchObject({ level: "suspect", risk: 40 });
  });

  it("raises an analysis sentence that also states the reveal outright", () => {
    const target = section("Themes", ["The twist is what the film is finally about."]);
    expect(assessmentAt(target).risk).toBe(85);
  });

  it("keeps the higher score when a plot sentence also hints at the ending", () => {
    const plot = section("Plot", [
      "The boy tells his mother what he sees.",
      "The ending leaves him at peace.",
    ]);
    expect(assessmentAt(plot, 1).risk).toBe(100);
    expect(assessmentAt(plot, 1).level).toBe("spoiler");
  });

  it("scores a heading that names the reveal, and leaves other headings unscored", () => {
    expect(assessHeading(section("Series finale"))).toMatchObject({ risk: 85 });
    expect(assessHeading(section("Production"))).toBeNull();
  });
});

describe("the sensitivity threshold", () => {
  const themes = section("Themes", ["Critics read the film as a study of grief."]);

  it("shows a sentence whose risk exactly matches the threshold", () => {
    expect(hiddenSentence(firstSentence(themes), themes, at(30))).toBe(false);
  });

  it("withholds a sentence one point above the threshold", () => {
    expect(hiddenSentence(firstSentence(themes), themes, at(31))).toBe(true);
  });

  it("withholds nothing at all at zero", () => {
    const plot = section("Plot", ["A boy who sees ghosts meets a child psychologist."]);
    expect(hiddenSentence(firstSentence(plot), plot, at(0))).toBe(false);
  });

  it("withholds every sentence that carries any risk at all at one hundred", () => {
    const hint = section("Reception", ["Reviewers praised the ending as the strongest part of the film."]);
    const meta = section("Production", ["The film was shot on location over eleven weeks."]);
    expect(hiddenSentence(firstSentence(hint), hint, at(100))).toBe(true);
    expect(hiddenSentence(firstSentence(meta), meta, at(100))).toBe(false);
  });
});

describe("the presets on the slider", () => {
  const reveal = section("Reception", ["Reviewers dwelt on the twist, that the narrator and Tyler are one man."]);
  const hint = section("Reception", ["Reviewers praised the ending as the strongest part of the film."]);
  const plot = section("Plot", ["A boy who sees ghosts meets a child psychologist."]);

  it("withholds plot summaries and outright reveals at fifty, but not weaker hints", () => {
    expect(hiddenSentence(firstSentence(plot), plot, at(50))).toBe(true);
    expect(hiddenSentence(firstSentence(reveal), reveal, at(50))).toBe(true);
    expect(hiddenSentence(firstSentence(hint), hint, at(50))).toBe(false);
  });

  it("withholds the weaker hint too at seventy-five", () => {
    expect(hiddenSentence(firstSentence(hint), hint, at(75))).toBe(true);
  });

  it("withholds nothing at zero", () => {
    expect(hiddenSentence(firstSentence(reveal), reveal, at(0))).toBe(false);
    expect(hiddenSentence(firstSentence(hint), hint, at(0))).toBe(false);
  });

  it("starts the reader at seventy-five", () => {
    expect(newPolicy().sensitivity).toBe(75);
  });
});

describe("what overrides what", () => {
  const meta = section("Production", ["The film was shot on location over eleven weeks."]);
  const plot = section("Plot", ["A boy who sees ghosts meets a child psychologist."]);
  const known = new Map([[meta.id, "you have seen it"]]);

  it("withholds a sentence the agent asked to withhold", () => {
    expect(hiddenSentence(firstSentence(meta), meta, at(75, { withheld: new Set(["p0.0"]) }))).toBe(true);
  });

  it("keeps withholding it at the lowest sensitivity that withholds anything", () => {
    expect(hiddenSentence(firstSentence(meta), meta, at(1, { withheld: new Set(["p0.0"]) }))).toBe(true);
  });

  it("shows an agent-withheld sentence at zero", () => {
    expect(hiddenSentence(firstSentence(meta), meta, at(0, { withheld: new Set(["p0.0"]) }))).toBe(false);
  });

  it("shows an agent-withheld sentence once the section is marked known", () => {
    const policy = at(75, { withheld: new Set(["p0.0"]), knownSections: known });
    expect(hiddenSentence(firstSentence(meta), meta, policy)).toBe(false);
  });

  it("shows an agent-withheld sentence the reader then revealed", () => {
    const policy = at(75, { withheld: new Set(["p0.0"]), revealed: new Set(["p0.0"]) });
    expect(hiddenSentence(firstSentence(meta), meta, policy)).toBe(false);
  });

  it("shows a revealed sentence at the highest sensitivity", () => {
    expect(hiddenSentence(firstSentence(plot), plot, at(100, { revealed: new Set(["p0.0"]) }))).toBe(false);
  });

  it("withholds a heading the agent asked to withhold", () => {
    expect(hiddenHeading(meta, at(75, { withheld: new Set([headingId(meta)]) }))).not.toBeNull();
  });

  it("says why a heading is withheld without naming it", () => {
    const policy = at(75, { withheld: new Set([headingId(meta)]) });
    expect(hiddenHeading(meta, policy)?.reason).not.toContain("Production");
  });

  it("shows an agent-withheld heading at zero", () => {
    expect(hiddenHeading(meta, at(0, { withheld: new Set([headingId(meta)]) }))).toBeNull();
  });

  it("shows an agent-withheld heading once revealed", () => {
    const ids = new Set([headingId(meta)]);
    expect(hiddenHeading(meta, at(75, { withheld: ids, revealed: ids }))).toBeNull();
  });

  it("shows an agent-withheld heading once the section is marked known", () => {
    const policy = at(75, { withheld: new Set([headingId(meta)]), knownSections: known });
    expect(hiddenHeading(meta, policy)).toBeNull();
  });

  it("keeps withholding a narrative heading that names the reveal", () => {
    const finale = section("Series finale", ["He was dead the whole time."]);
    expect(hiddenHeading(finale, newPolicy())?.reason).toBe("the heading itself names the reveal");
    expect(hiddenHeading(plot, newPolicy())).toBeNull();
  });

  it("shows a heading that names the reveal once the sensitivity drops below its score", () => {
    const finale = section("Series finale", ["He was dead the whole time."]);
    expect(hiddenHeading(finale, at(15))).toBeNull();
    expect(hiddenHeading(finale, at(16))).not.toBeNull();
  });
});

describe("counting what is withheld", () => {
  const article = {
    lang: "en" as const,
    title: "The Sixth Sense",
    displayTitle: "The Sixth Sense",
    sourceUrl: "https://en.wikipedia.org/wiki/The_Sixth_Sense",
    sections: [
      section("Production", ["The film was shot on location over eleven weeks."]),
      {
        ...section("Plot", ["A boy meets a psychologist.", "The psychologist goes home."]),
        id: "s2",
      },
    ],
  };

  it("counts fewer withheld sentences as the reader lowers the slider", () => {
    expect(countHidden(article, newPolicy(75))).toEqual({ hidden: 2, total: 3 });
    expect(countHidden(article, newPolicy(35))).toEqual({ hidden: 1, total: 3 });
    expect(countHidden(article, newPolicy(0))).toEqual({ hidden: 0, total: 3 });
  });
});

describe("wording that reads like a reveal but is not", () => {
  it.each([
    "Garofalo revealed that she did accept the role, but was dropped from the cast.",
    "Fincher revealed that the studio had asked for a softer ending.",
  ])("treats %s as a hint at most", (text) => {
    const target = section("Casting", [text]);
    expect(assessmentAt(target).level).toBe("suspect");
  });

  it("still catches the passive reveal a plot summary uses", () => {
    const target = section("Reception", ["It is revealed that the narrator has been alone the whole time."]);
    expect(assessmentAt(target).level).toBe("spoiler");
  });
});
