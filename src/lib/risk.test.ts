import { describe, expect, it } from "vitest";
import type { Section } from "./segment";
import {
  assessSection,
  assessSentence,
  defaultPolicy,
  headingId,
  hiddenHeading,
  hiddenSentence,
  type Policy,
} from "./risk";

function section(heading: string, texts: string[] = ["The film was shot on location over eleven weeks."]): Section {
  return {
    id: "s1",
    heading,
    level: 2,
    paragraphs: [{ id: "p0", sentences: texts.map((text, index) => ({ id: `p0.${index}`, text })) }],
  };
}

function firstSentence(target: Section) {
  return target.paragraphs[0].sentences[0];
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
    expect(assessSentence(firstSentence(target), target).reason).not.toContain("finale");
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
    expect(assessSentence(firstSentence(target), target).level).toBe("safe");
  });
});

describe("policy levels", () => {
  const at = (level: Policy["level"]): Policy => ({ ...defaultPolicy, level });

  it("rates a sentence that states the reveal outright as a spoiler", () => {
    const target = section("Reception", ["Reviewers dwelt on the twist, that the narrator and Tyler are one man."]);
    expect(assessSentence(firstSentence(target), target).level).toBe("spoiler");
  });

  it("rates a weaker hint as suspect", () => {
    const target = section("Reception", ["Reviewers praised the ending as the strongest part of the film."]);
    expect(assessSentence(firstSentence(target), target).level).toBe("suspect");
  });

  it("withholds the reveal inside a non-narrative section at balanced", () => {
    const target = section("Reception", ["Reviewers dwelt on the twist, that the narrator and Tyler are one man."]);
    expect(hiddenSentence(firstSentence(target), target, at("balanced"))).toBe(true);
  });

  it("shows a weaker hint at balanced but withholds it at strict", () => {
    const target = section("Reception", ["Reviewers praised the ending as the strongest part of the film."]);
    expect(hiddenSentence(firstSentence(target), target, at("balanced"))).toBe(false);
    expect(hiddenSentence(firstSentence(target), target, at("strict"))).toBe(true);
  });

  it("withholds narrative sections at balanced", () => {
    const target = section("Plot", ["A boy who sees ghosts meets a child psychologist."]);
    expect(hiddenSentence(firstSentence(target), target, at("balanced"))).toBe(true);
  });

  it("withholds nothing at open", () => {
    const target = section("Plot", ["A boy who sees ghosts meets a child psychologist."]);
    expect(hiddenSentence(firstSentence(target), target, at("open"))).toBe(false);
  });
});

describe("what overrides what", () => {
  const meta = section("Production", ["The film was shot on location over eleven weeks."]);
  const plot = section("Plot", ["A boy who sees ghosts meets a child psychologist."]);
  const known = [{ sectionId: meta.id, because: "you have seen it" }];

  it("withholds a sentence the agent asked to withhold", () => {
    const policy = { ...defaultPolicy, withheld: ["p0.0"] };
    expect(hiddenSentence(firstSentence(meta), meta, policy)).toBe(true);
  });

  it("shows an agent-withheld sentence at open", () => {
    const policy: Policy = { ...defaultPolicy, level: "open", withheld: ["p0.0"] };
    expect(hiddenSentence(firstSentence(meta), meta, policy)).toBe(false);
  });

  it("shows an agent-withheld sentence once the section is marked known", () => {
    const policy = { ...defaultPolicy, withheld: ["p0.0"], knownSections: known };
    expect(hiddenSentence(firstSentence(meta), meta, policy)).toBe(false);
  });

  it("shows an agent-withheld sentence the reader then revealed", () => {
    const policy = { ...defaultPolicy, withheld: ["p0.0"], revealed: ["p0.0"] };
    expect(hiddenSentence(firstSentence(meta), meta, policy)).toBe(false);
  });

  it("withholds a heading the agent asked to withhold", () => {
    const policy = { ...defaultPolicy, withheld: [headingId(meta)] };
    expect(hiddenHeading(meta, policy)).not.toBeNull();
  });

  it("says why a heading is withheld without naming it", () => {
    const policy = { ...defaultPolicy, withheld: [headingId(meta)] };
    expect(hiddenHeading(meta, policy)?.reason).not.toContain("Production");
  });

  it("shows an agent-withheld heading at open", () => {
    const policy: Policy = { ...defaultPolicy, level: "open", withheld: [headingId(meta)] };
    expect(hiddenHeading(meta, policy)).toBeNull();
  });

  it("shows an agent-withheld heading once revealed", () => {
    const policy = { ...defaultPolicy, withheld: [headingId(meta)], revealed: [headingId(meta)] };
    expect(hiddenHeading(meta, policy)).toBeNull();
  });

  it("shows an agent-withheld heading once the section is marked known", () => {
    const policy = { ...defaultPolicy, withheld: [headingId(meta)], knownSections: known };
    expect(hiddenHeading(meta, policy)).toBeNull();
  });

  it("keeps withholding a narrative heading that names the reveal", () => {
    const finale = section("Series finale", ["He was dead the whole time."]);
    expect(hiddenHeading(finale, defaultPolicy)?.reason).toBe("the heading itself names the reveal");
    expect(hiddenHeading(plot, defaultPolicy)).toBeNull();
  });
});

describe("wording that reads like a reveal but is not", () => {
  it.each([
    "Garofalo revealed that she did accept the role, but was dropped from the cast.",
    "Fincher revealed that the studio had asked for a softer ending.",
  ])("treats %s as a hint at most", (text) => {
    const target = section("Casting", [text]);
    expect(assessSentence(firstSentence(target), target).level).toBe("suspect");
  });

  it("still catches the passive reveal a plot summary uses", () => {
    const target = section("Reception", ["It is revealed that the narrator has been alone the whole time."]);
    expect(assessSentence(firstSentence(target), target).level).toBe("spoiler");
  });
});
