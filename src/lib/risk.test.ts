import { describe, expect, it } from "vitest";
import type { Rule } from "./rules";
import type { Section } from "./segment";
import {
  assessSection,
  assessSentences,
  countHidden,
  hiddenSentence,
  hiddenSentenceReason,
  maskWith,
  newPolicy,
  type Policy,
} from "./risk";

function section(heading: string, texts: string[] = ["The film was shot on location over eleven weeks."]): Section {
  return {
    id: "s1",
    heading,
    headingPath: [heading],
    level: 2,
    paragraphs: [{ id: "p0", sentences: texts.map((text, index) => ({ id: `p0.${index}`, text, runs: [{ kind: "text", text }] })) }],
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
      expect(assessSection(section(heading)).level).not.toBe("spoiler");
    },
  );

  it.each(["Production", "Release", "Box office", "受賞"])("vouches for %s as safe", (heading) => {
    expect(assessSection(section(heading))).toMatchObject({ level: "safe", risk: 0 });
  });

  it("holds back a section it can neither read as narrative nor vouch for", () => {
    expect(assessSection(section("Merchandise"))).toMatchObject({ level: "suspect", risk: 20 });
  });

  it("holds back the lead, which sums up the ending along with everything else", () => {
    expect(assessSection(section("(lead)"))).toMatchObject({ level: "suspect", risk: 20 });
  });
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
    expect(scores).toEqual([40, 55, 70, 85, 100]);
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

  it("scores a sentence for the kind of spoiler its wording carries", () => {
    const target = section("Reception", ["Reviewers dwelt on the scene in which the psychologist dies."]);
    expect(assessmentAt(target)).toMatchObject({ level: "spoiler", risk: 90, category: "death" });
  });

  it("scores wording that only leans towards the ending far below one that states it", () => {
    const target = section("Reception", ["Reviewers praised the ending as the strongest part of the film."]);
    expect(assessmentAt(target)).toMatchObject({ level: "suspect", risk: 40, category: "hint" });
  });

  it("raises an analysis sentence whose wording gives away more than the section does", () => {
    const target = section("Themes", ["Critics read the film through the mother, who dies in the first act."]);
    expect(assessmentAt(target)).toMatchObject({ risk: 90, category: "death" });
  });

  it("keeps the section's score where the wording gives away less", () => {
    const target = section("Themes", ["Critics dwelt on the ending as a study of grief."]);
    expect(assessmentAt(target).risk).toBe(70);
    expect(assessmentAt(target).category).toBeUndefined();
  });

  it("keeps the higher score when a plot sentence also hints at the ending", () => {
    const plot = section("Plot", [
      "The boy tells his mother what he sees.",
      "The ending leaves him at peace.",
    ]);
    expect(assessmentAt(plot, 1).risk).toBe(100);
    expect(assessmentAt(plot, 1).level).toBe("spoiler");
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
  const death = section("Reception", ["Reviewers dwelt on the scene in which the psychologist dies."]);
  const outcome = section("Reception", ["In the end the narrator wins the argument with himself."]);
  const ending = section("Reception", ["The epilogue drew the most comment."]);
  const hint = section("Reception", ["Reviewers praised the ending as the strongest part of the film."]);

  const article = {
    lang: "en" as const,
    title: "The Sixth Sense",
    displayTitle: "The Sixth Sense",
    sourceUrl: "https://en.wikipedia.org/wiki/The_Sixth_Sense",
    references: [],
    sections: [
      section("Production", ["The film was shot on location over eleven weeks."]),
      {
        ...section("Plot", [
          "A boy who sees ghosts meets a child psychologist.",
          "They meet again through the winter.",
          "The boy tells his mother what he sees.",
          "The psychologist goes home for the last time.",
          "He accepts what has happened and moves on.",
        ]),
        id: "s2",
      },
      {
        ...section("Reception", [
          "Reviewers dwelt on the scene in which the psychologist dies.",
          "In the end the narrator wins the argument with himself.",
          "The epilogue drew the most comment.",
          "Reviewers praised the ending as the strongest part of the film.",
        ]),
        id: "s3",
      },
      { ...section("Merchandise", ["A tie-in card game followed in 2001."]), id: "s4" },
    ],
  };

  it("withholds nothing at all where the reader asked for everything", () => {
    expect(hiddenSentence(firstSentence(death), death, at(0))).toBe(false);
    expect(hiddenSentence(firstSentence(hint), hint, at(0))).toBe(false);
  });

  it("withholds who dies but not how it turns out where only the ending is withheld", () => {
    expect(hiddenSentence(firstSentence(death), death, at(20))).toBe(true);
    expect(hiddenSentence(firstSentence(outcome), outcome, at(20))).toBe(false);
  });

  it("withholds how it turns out, but not the closing scenes, at the major-spoiler point", () => {
    expect(hiddenSentence(firstSentence(outcome), outcome, at(45))).toBe(true);
    expect(hiddenSentence(firstSentence(ending), ending, at(45))).toBe(false);
  });

  it("withholds the closing scenes and wording that only hints, at the spoiler-safe point", () => {
    expect(hiddenSentence(firstSentence(ending), ending, at(65))).toBe(true);
    expect(hiddenSentence(firstSentence(hint), hint, at(65))).toBe(true);
  });

  it("withholds a section it cannot vouch for only at the strongest point", () => {
    const unvouched = section("Merchandise", ["A tie-in card game followed in 2001."]);
    expect(hiddenSentence(firstSentence(unvouched), unvouched, at(65))).toBe(false);
    expect(hiddenSentence(firstSentence(unvouched), unvouched, at(100))).toBe(true);
  });

  it("withholds strictly more of an article at each named point", () => {
    const withheld = [0, 20, 45, 65, 100].map((sensitivity) => countHidden(article, newPolicy(sensitivity)).hidden);
    expect(withheld).toEqual([0, 3, 5, 9, 10]);
  });

  it("starts the reader where a plot summary is withheld whole", () => {
    expect(newPolicy().sensitivity).toBe(65);
  });
});

describe("what overrides what", () => {
  const meta = section("Production", ["The film was shot on location over eleven weeks."]);
  const plot = section("Plot", ["A boy who sees ghosts meets a child psychologist."]);

  it("withholds a sentence a decision hid, whatever the wording rules make of it", () => {
    expect(hiddenSentence(firstSentence(meta), meta, at(75, { hidden: new Set(["p0.0"]) }))).toBe(true);
  });

  it("keeps withholding it at the sensitivity that withholds nothing else", () => {
    expect(hiddenSentence(firstSentence(meta), meta, at(0, { hidden: new Set(["p0.0"]) }))).toBe(true);
  });

  it("shows a sentence a decision showed, at the sensitivity that withholds everything", () => {
    expect(hiddenSentence(firstSentence(plot), plot, at(100, { shown: new Set(["p0.0"]) }))).toBe(false);
  });

  it("withholds a sentence that a decision both showed and hid", () => {
    const policy = at(0, { shown: new Set(["p0.0"]), hidden: new Set(["p0.0"]) });
    expect(hiddenSentence(firstSentence(plot), plot, policy)).toBe(true);
  });

  it("says a sentence is withheld by a decision without naming what is in it", () => {
    const policy = at(75, { hidden: new Set(["p0.0"]) });
    expect(hiddenSentenceReason(firstSentence(meta), meta, policy)?.reason).toBe(
      "withheld by a decision on this page",
    );
  });
});

describe("a rule the reader or their agent added", () => {
  const meta = section("Production", ["The film was shot on location over eleven weeks."]);

  const readersRule: Rule = {
    id: "r1",
    phrases: ["eleven weeks"],
    label: "eleven weeks",
    scope: "article",
    origin: "reader",
    at: 0,
  };

  const agentsRule: Rule = {
    id: "r2",
    phrases: ["eleven weeks"],
    label: "How long the shoot ran",
    scope: "article",
    origin: "agent",
    reason: "you asked not to know how it was made",
    at: 0,
  };

  function withRule(sensitivity: number, rule: Rule = readersRule): Policy {
    return at(sensitivity, { rules: [rule] });
  }

  it("withholds a sentence the wording rules found nothing wrong with", () => {
    expect(hiddenSentence(firstSentence(meta), meta, withRule(65))).toBe(true);
  });

  it("goes on withholding it where the page withholds nothing else", () => {
    expect(hiddenSentence(firstSentence(meta), meta, withRule(0))).toBe(true);
  });

  it("tells the reader it was their own rule, without repeating the phrase", () => {
    const reason = hiddenSentenceReason(firstSentence(meta), meta, withRule(65))?.reason;
    expect(reason).toBe("matches one of your rules");
    expect(reason).not.toContain("eleven weeks");
  });

  it("says when the rule was one the agent added", () => {
    const policy = withRule(65, agentsRule);
    expect(hiddenSentenceReason(firstSentence(meta), meta, policy)?.reason).toBe(
      "matches a rule your agent added",
    );
  });

  it("gives way to a sentence the reader has opened", () => {
    const policy = { ...withRule(65), shown: new Set(["p0.0"]) };
    expect(hiddenSentence(firstSentence(meta), meta, policy)).toBe(false);
  });

  it("gives way to a decision that opened the sentence", () => {
    const policy = maskWith(withRule(65), ["p0.0"], []);
    expect(hiddenSentence(firstSentence(meta), meta, policy)).toBe(false);
  });

  it("is outranked by a decision that closed the sentence", () => {
    const policy = maskWith(withRule(0), [], ["p0.0"]);
    expect(hiddenSentenceReason(firstSentence(meta), meta, policy)?.reason).toBe(
      "withheld by a decision on this page",
    );
  });

  it("starts the reader with none", () => {
    expect(newPolicy().rules).toEqual([]);
  });
});

describe("applying a decision to the policy", () => {
  it("starts the reader with nothing shown, nothing hidden and no decisions", () => {
    expect(newPolicy()).toMatchObject({ shown: new Set(), hidden: new Set(), decisions: [] });
  });

  it("takes a shown sentence back out of hidden", () => {
    const policy = maskWith(at(75, { hidden: new Set(["p0.0"]) }), ["p0.0"], []);
    expect([...policy.hidden]).toEqual([]);
    expect([...policy.shown]).toEqual(["p0.0"]);
  });

  it("takes a hidden sentence back out of shown", () => {
    const policy = maskWith(at(75, { shown: new Set(["p0.0"]) }), [], ["p0.0"]);
    expect([...policy.shown]).toEqual([]);
    expect([...policy.hidden]).toEqual(["p0.0"]);
  });

  it("hides a sentence named on both sides of one decision", () => {
    const policy = maskWith(newPolicy(), ["p0.0"], ["p0.0"]);
    expect([...policy.hidden]).toEqual(["p0.0"]);
    expect([...policy.shown]).toEqual([]);
  });
});

describe("counting what is withheld", () => {
  const article = {
    lang: "en" as const,
    title: "The Sixth Sense",
    displayTitle: "The Sixth Sense",
    sourceUrl: "https://en.wikipedia.org/wiki/The_Sixth_Sense",
    references: [],
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
