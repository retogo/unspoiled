import { describe, expect, it } from "vitest";
import { strongestCategory } from "./categories";

describe("what a sentence gives away", () => {
  it.each([
    ["The psychologist dies in the opening scene.", "death"],
    ["Cole's father is actually the man in the hall.", "identity"],
    ["The detective escapes through the tunnel.", "outcome"],
    ["The narrator transforms into someone else entirely.", "return"],
    ["She is married to the man from the bar.", "relationship"],
    ["The epilogue moves ten years on.", "ending"],
    ["The secret gets out before the interval.", "hint"],
  ])("reads %s as a %s", (text, category) => {
    expect(strongestCategory(text)?.category).toBe(category);
  });

  it.each([
    ["主人公は最終的に命を落とす。", "death"],
    ["男の正体は語り手自身だった。", "identity"],
    ["犯人は逮捕される。", "outcome"],
    ["彼は物語の後半で復活する。", "return"],
    ["二人は双子である。", "relationship"],
    ["クライマックスは屋上で起きる。", "ending"],
    ["秘密は最後まで明かされない。", "hint"],
  ])("reads %s as a %s", (text, category) => {
    expect(strongestCategory(text)?.category).toBe(category);
  });

  it("weighs who dies and who someone really is above everything else", () => {
    expect(strongestCategory("The psychologist dies in the opening scene.")?.weight).toBe(90);
    expect(strongestCategory("Cole's father is actually the man in the hall.")?.weight).toBe(90);
  });

  it("weighs the kinds of spoiler in the order a reader minds them", () => {
    const weightOf = (text: string) => strongestCategory(text)?.weight;
    expect(weightOf("The detective escapes through the tunnel.")).toBe(75);
    expect(weightOf("The narrator transforms into someone else entirely.")).toBe(70);
    expect(weightOf("She is married to the man from the bar.")).toBe(60);
    expect(weightOf("The epilogue moves ten years on.")).toBe(55);
    expect(weightOf("The secret gets out before the interval.")).toBe(40);
  });

  it("takes the strongest of the kinds a sentence carries", () => {
    expect(strongestCategory("He dies in the epilogue.")).toMatchObject({ category: "death", weight: 90 });
  });

  it("reads a sentence the same way whatever its case", () => {
    expect(strongestCategory("THE PSYCHOLOGIST DIES IN THE OPENING SCENE.")?.category).toBe("death");
  });
});

describe("wording that only reads like a spoiler", () => {
  it.each([
    "Actually, filming began in 2001 on a soundstage in Los Angeles.",
    "The film was released in 1999 and became a sleeper hit.",
    "The film was shot on location over eleven weeks.",
    "Principal photography wrapped after eleven weeks.",
    "最後に劇場公開されたのは2003年である。",
    "撮影は十一週間にわたって行われた。",
  ])("finds nothing in %s", (text) => {
    expect(strongestCategory(text)).toBeNull();
  });

  it("does not match a word that merely contains one", () => {
    expect(strongestCategory("The diesel engine was rebuilt for the shoot.")).toBeNull();
    expect(strongestCategory("Twisted metal filled the set.")).toBeNull();
  });
});

describe("what the reader is told about a withheld sentence", () => {
  it("names the kind of spoiler without quoting the wording that gave it away", () => {
    const match = strongestCategory("The psychologist dies in the opening scene.");
    expect(match?.reason).toBe("a sentence that names who dies");
    expect(match?.reason).not.toContain("psychologist");
  });

  it("gives every kind its own words", () => {
    const reasons = [
      "The psychologist dies in the opening scene.",
      "Cole's father is actually the man in the hall.",
      "The detective escapes through the tunnel.",
      "The narrator transforms into someone else entirely.",
      "She is married to the man from the bar.",
      "The epilogue moves ten years on.",
      "The secret gets out before the interval.",
    ].map((text) => strongestCategory(text)?.reason);
    expect(new Set(reasons).size).toBe(reasons.length);
  });
});
