import { describe, expect, it } from "vitest";
import { countMatching, fold, matchingRule, nextRuleId, type Rule } from "./rules";

function rule(phrases: string[], overrides: Partial<Rule> = {}): Rule {
  return {
    id: "r1",
    phrases,
    label: phrases[0],
    scope: "article",
    origin: "reader",
    at: 0,
    ...overrides,
  };
}

const SENTENCE = "Malcolm understands that he has been a ghost since the opening scene.";

describe("a phrase the reader asked to hide", () => {
  it("matches a sentence that contains it", () => {
    expect(matchingRule(SENTENCE, [rule(["ghost"])])).not.toBeNull();
  });

  it("leaves a sentence that does not contain it", () => {
    expect(matchingRule(SENTENCE, [rule(["Tyler Durden"])])).toBeNull();
  });

  it("matches part of a word, because the reader typed part of a name", () => {
    expect(matchingRule(SENTENCE, [rule(["Malc"])])).not.toBeNull();
  });

  it("ignores the case the reader typed", () => {
    expect(matchingRule(SENTENCE, [rule(["GHOST"])])).not.toBeNull();
    expect(matchingRule("A GHOST STORY", [rule(["ghost"])])).not.toBeNull();
  });

  it("ignores the difference between full and half width", () => {
    expect(matchingRule("Malcolm is a ghost.", [rule(["ｇｈｏｓｔ"])])).not.toBeNull();
    expect(matchingRule("エレンは巨人になる。", [rule(["ｼﾞｬｲｱﾝﾄ"])])).toBeNull();
    expect(matchingRule("ジャイアントが現れる。", [rule(["ｼﾞｬｲｱﾝﾄ"])])).not.toBeNull();
  });

  it("matches when any one of a rule's phrases does", () => {
    expect(matchingRule(SENTENCE, [rule(["Tyler", "ghost"])])).not.toBeNull();
  });

  it("reports which rule matched, so the reader is told whose it was", () => {
    const readers = rule(["Tyler"], { id: "r1" });
    const agents = rule(["ghost"], { id: "r2", origin: "agent" });
    expect(matchingRule(SENTENCE, [readers, agents])?.id).toBe("r2");
  });

  it("never matches on a phrase that is only spaces", () => {
    expect(matchingRule(SENTENCE, [rule(["   "])])).toBeNull();
  });

  it("matches nothing when the reader has no rules", () => {
    expect(matchingRule(SENTENCE, [])).toBeNull();
  });
});

describe("how much of an article a rule reaches", () => {
  it("counts the sentences it matches, not the phrases that matched", () => {
    const texts = ["Malcolm is a ghost.", "A ghost story for the winter.", "The film was shot in Philadelphia."];
    expect(countMatching(rule(["ghost", "winter"]), texts)).toBe(2);
  });

  it("counts nothing when it reaches nothing", () => {
    expect(countMatching(rule(["Tyler"]), ["Malcolm is a ghost."])).toBe(0);
  });
});

describe("folding text before comparing it", () => {
  it("leaves nothing between two spellings of the same phrase", () => {
    expect(fold("Ｔｙｌｅｒ")).toBe(fold("tyler"));
    expect(fold("ﾀｲﾗｰ")).toBe(fold("タイラー"));
  });
});

describe("naming a new rule", () => {
  it("numbers it past every rule already stored", () => {
    expect(nextRuleId([rule([""], { id: "r1" }), rule([""], { id: "r7" })])).toBe("r8");
  });

  it("starts at one when nothing is stored", () => {
    expect(nextRuleId([])).toBe("r1");
  });

  it("is not thrown off by an id it did not write", () => {
    expect(nextRuleId([rule([""], { id: "whatever" })])).toBe("r1");
  });
});
