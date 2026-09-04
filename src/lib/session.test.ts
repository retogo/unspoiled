import { describe, expect, it } from "vitest";
import { DEFAULT_SENSITIVITY, newPolicy, type Policy } from "./risk";
import type { Rule, RuleScope } from "./rules";
import type { Article, Section } from "./segment";
import type { Lang } from "./wikipedia";
import {
  allRules,
  articleKey,
  historyActionFor,
  policyForOpened,
  readArticleTarget,
  readRuleStore,
  readSessionStart,
  recordScanned,
  revealedOnPage,
  rulesFor,
  scannedElsewhere,
  scannedForArticle,
  storedWith,
  storedWithout,
  type RuleStore,
} from "./session";

function article(lang: Lang, title: string, sections: Section[] = []): Article {
  return {
    lang,
    title,
    displayTitle: title,
    sourceUrl: `https://${lang}.wikipedia.org/wiki/${title}`,
    sections,
    references: [],
  };
}

function section(id: string, heading: string, sentenceIds: string[]): Section {
  return {
    id,
    heading,
    headingPath: [heading],
    level: 2,
    paragraphs: [{ id: `p${id}`, sentences: sentenceIds.map((sentenceId) => ({
        id: sentenceId,
        text: sentenceId,
        runs: [{ kind: "text", text: sentenceId }],
      })) }],
  };
}

const usedPolicy: Policy = {
  sensitivity: 50,
  shown: new Set(["p1.0"]),
  hidden: new Set(["p2.1"]),
  rules: [],
  decisions: [
    { kind: "mask", at: 0, show: ["p1.0"], hide: ["p2.1"], reason: "you have watched the first season" },
  ],
};

function rule(id: string, phrase: string, scope: RuleScope = "article"): Rule {
  return { id, phrases: [phrase], label: phrase, scope, origin: "reader", at: 0 };
}

describe("readSessionStart", () => {
  it("keeps the reader's stored sensitivity instead of the one in a shared link", () => {
    const start = readSessionStart("?sensitivity=0&title=The%20Sixth%20Sense", "90");
    expect(start.policy.sensitivity).toBe(90);
  });

  it("takes the sensitivity from a shared link when the reader has nothing stored", () => {
    expect(readSessionStart("?sensitivity=50", null).policy.sensitivity).toBe(50);
  });

  it("reads the ends of the scale from a shared link", () => {
    expect(readSessionStart("?sensitivity=0", null).policy.sensitivity).toBe(0);
    expect(readSessionStart("?sensitivity=100", null).policy.sensitivity).toBe(100);
  });

  it.each(["everything", "", "-1", "101", "50.5", " 50", "1e2", "0x20"])(
    "ignores %s, which is not a point on the scale",
    (raw) => {
      expect(readSessionStart(`?sensitivity=${encodeURIComponent(raw)}`, null).policy.sensitivity).toBe(
        DEFAULT_SENSITIVITY,
      );
      expect(readSessionStart("", raw).policy.sensitivity).toBe(DEFAULT_SENSITIVITY);
    },
  );

  it("falls back to the default when a stored value is junk but the link is good", () => {
    expect(readSessionStart("?sensitivity=20", "everything").policy.sensitivity).toBe(20);
  });

  it("starts an untouched reader at the default", () => {
    expect(readSessionStart("", null).policy.sensitivity).toBe(DEFAULT_SENSITIVITY);
  });

  it("reads the shared article title and language", () => {
    expect(readSessionStart("?lang=ja&title=シックス・センス", null).article).toEqual({
      lang: "ja",
      title: "シックス・センス",
    });
  });

  it("ignores a language that is not a Wikipedia edition the reader can pick", () => {
    expect(readSessionStart("?lang=xx&title=The%20Sixth%20Sense", null).article).toEqual({
      lang: "en",
      title: "The Sixth Sense",
    });
  });

  it("opens no article when the link carries no title", () => {
    expect(readSessionStart("?lang=ja", null).article).toBeNull();
  });
});

describe("policyForOpened", () => {
  it("clears everything tied to the previous article's sentence ids", () => {
    const next = policyForOpened(usedPolicy, article("en", "Attack on Titan"), article("en", "The Sixth Sense"), []);
    expect(next).toEqual(newPolicy(50));
  });

  it("keeps the reader's sensitivity, which is not tied to any article", () => {
    const next = policyForOpened(usedPolicy, article("en", "Attack on Titan"), article("en", "The Sixth Sense"), []);
    expect(next.sensitivity).toBe(50);
  });

  it("keeps what the reader has opened when the same article is opened again", () => {
    const open = article("en", "Attack on Titan");
    expect(policyForOpened(usedPolicy, open, article("en", "Attack on Titan"), [])).toBe(usedPolicy);
  });

  it("treats the same title in another language as another article", () => {
    const next = policyForOpened(usedPolicy, article("en", "The Sixth Sense"), article("ja", "The Sixth Sense"), []);
    expect(next.shown.size).toBe(0);
  });

  it("clears the previous article's state when the first article is opened", () => {
    expect(policyForOpened(usedPolicy, null, article("en", "The Sixth Sense"), []).hidden.size).toBe(0);
  });

  it("carries the rules that apply to the article being opened", () => {
    const rules = [rule("r1", "Levi", "all")];
    const next = policyForOpened(usedPolicy, article("en", "Attack on Titan"), article("en", "The Sixth Sense"), rules);
    expect(next.rules).toEqual(rules);
  });
});

describe("the rules the reader has stored", () => {
  const titan = articleKey("en", "Attack on Titan");
  const stored: RuleStore = {
    all: [rule("r1", "Levi", "all")],
    byArticle: { [titan]: [rule("r2", "Eren")] },
  };

  it("keeps a rule through a round trip", () => {
    expect(readRuleStore(JSON.stringify(stored))).toEqual(stored);
  });

  it.each(["", "not json", "null", "[]", '"a phrase"', '{"all":3}', '{"byArticle":[]}'])(
    "ignores %s, which is not a set of rules",
    (raw) => {
      expect(readRuleStore(raw)).toEqual({ all: [], byArticle: {} });
    },
  );

  it("reads nothing for a reader who has stored nothing", () => {
    expect(readRuleStore(null)).toEqual({ all: [], byArticle: {} });
  });

  it.each([
    { phrases: ["Levi"], label: "Levi", scope: "all", origin: "reader", at: 0 },
    { id: "r1", label: "Levi", scope: "all", origin: "reader", at: 0 },
    { id: "r1", phrases: [], label: "Levi", scope: "all", origin: "reader", at: 0 },
    { id: "r1", phrases: ["Levi"], label: "  ", scope: "all", origin: "reader", at: 0 },
    { id: "r1", phrases: ["Levi"], label: "Levi", scope: "everywhere", origin: "reader", at: 0 },
    { id: "r1", phrases: ["Levi"], label: "Levi", scope: "all", origin: "someone else", at: 0 },
    { id: "r1", phrases: [7], label: "Levi", scope: "all", origin: "reader", at: 0 },
  ])("drops a stored entry that is not a rule", (entry) => {
    expect(readRuleStore(JSON.stringify({ all: [entry], byArticle: {} })).all).toEqual([]);
  });

  it("keeps the rules that are rules alongside one that is not", () => {
    const raw = JSON.stringify({ all: [rule("r1", "Levi", "all"), { id: "r2" }], byArticle: {} });
    expect(readRuleStore(raw).all).toEqual([rule("r1", "Levi", "all")]);
  });

  it("applies an every-article rule whatever is open", () => {
    expect(rulesFor(stored, { lang: "en", title: "The Sixth Sense" })).toEqual([rule("r1", "Levi", "all")]);
  });

  it("applies a rule made on one article only while that article is open", () => {
    expect(rulesFor(stored, { lang: "en", title: "Attack on Titan" })).toEqual([
      rule("r1", "Levi", "all"),
      rule("r2", "Eren"),
    ]);
  });

  it("applies the every-article rules on the search screen", () => {
    expect(rulesFor(stored, null)).toEqual([rule("r1", "Levi", "all")]);
  });

  it("counts every stored rule, wherever it applies", () => {
    expect(allRules(stored).map((entry) => entry.id)).toEqual(["r1", "r2"]);
  });

  it("puts a new rule where its scope says it belongs", () => {
    const next = storedWith(stored, titan, [rule("r3", "Mikasa"), rule("r4", "Hange", "all")]);
    expect(next.byArticle[titan].map((entry) => entry.id)).toEqual(["r2", "r3"]);
    expect(next.all.map((entry) => entry.id)).toEqual(["r1", "r4"]);
  });

  it("starts an article's list with the first rule made on it", () => {
    const key = articleKey("en", "The Sixth Sense");
    expect(storedWith(stored, key, [rule("r3", "Cole")]).byArticle[key]).toEqual([rule("r3", "Cole")]);
  });

  it("leaves the store it was given alone", () => {
    storedWith(stored, titan, [rule("r3", "Mikasa")]);
    expect(allRules(stored).map((entry) => entry.id)).toEqual(["r1", "r2"]);
  });

  it("takes a rule out of whichever list holds it", () => {
    expect(allRules(storedWithout(stored, "r1")).map((entry) => entry.id)).toEqual(["r2"]);
    expect(allRules(storedWithout(stored, "r2")).map((entry) => entry.id)).toEqual(["r1"]);
  });
});

describe("scanned sections", () => {
  const scanned = [
    { articleKey: articleKey("en", "Attack on Titan"), articleTitle: "Attack on Titan", sectionId: "s2" },
    { articleKey: articleKey("en", "The Sixth Sense"), articleTitle: "The Sixth Sense", sectionId: "s1" },
    { articleKey: articleKey("ja", "シックス・センス"), articleTitle: "シックス・センス", sectionId: "s1" },
  ];

  it("reports only the sections read in the article that is open", () => {
    expect(scannedForArticle(scanned, article("en", "The Sixth Sense"))).toEqual(["s1"]);
  });

  it("reports nothing while no article is open", () => {
    expect(scannedForArticle(scanned, null)).toEqual([]);
  });

  it("counts the sections read in other articles without naming their headings", () => {
    expect(scannedElsewhere(scanned, article("en", "The Sixth Sense"))).toEqual([
      { articleTitle: "Attack on Titan", sections: 1 },
      { articleTitle: "シックス・センス", sections: 1 },
    ]);
  });
});

describe("what is open on the page", () => {
  const open = article("en", "Attack on Titan", [
    section("s0", "(lead)", ["p0.0", "p0.1"]),
    section("s1", "Plot", ["p1.0", "p1.1", "p1.2"]),
    section("s2", "Series finale", ["p2.0"]),
  ]);

  function showing(ids: string[]): Policy {
    return { ...newPolicy(), shown: new Set(ids) };
  }

  it("groups what has been opened by the section it sits in", () => {
    expect(revealedOnPage(open, showing(["p1.0", "p1.2"]))).toEqual([
      { section: open.sections[1], ids: ["p1.0", "p1.2"] },
    ]);
  });

  it("leaves out a sentence a decision closed again", () => {
    expect(revealedOnPage(open, { ...showing(["p1.0"]), hidden: new Set(["p1.2"]) })).toEqual([
      { section: open.sections[1], ids: ["p1.0"] },
    ]);
  });

  it("reports nothing opened while no article is on screen", () => {
    expect(revealedOnPage(null, showing(["p1.0"]))).toEqual([]);
  });
});

describe("the record of what the agent has read", () => {
  const open = article("en", "Attack on Titan", []);
  const other = article("en", "The Sixth Sense");

  it("records a section once, however often it is read", () => {
    const scanned = recordScanned(recordScanned([], open, "s1"), open, "s1");
    expect(scanned).toEqual([
      { articleKey: articleKey("en", "Attack on Titan"), articleTitle: "Attack on Titan", sectionId: "s1" },
    ]);
  });

  it("keeps the record of a section read in another article", () => {
    const scanned = recordScanned(recordScanned([], other, "s4"), open, "s1");
    expect(scannedForArticle(scanned, other)).toEqual(["s4"]);
    expect(scannedElsewhere(scanned, other)).toEqual([{ articleTitle: "Attack on Titan", sections: 1 }]);
  });
});

describe("readArticleTarget", () => {
  it("reads the article a URL names", () => {
    expect(readArticleTarget("?lang=ja&title=シックス・センス&sensitivity=40")).toEqual({
      lang: "ja",
      title: "シックス・センス",
    });
  });

  it("falls back to English when the language is not an edition the reader could pick", () => {
    expect(readArticleTarget("?lang=xx&title=The%20Sixth%20Sense")).toEqual({
      lang: "en",
      title: "The Sixth Sense",
    });
  });

  it("names no article when the URL carries no title", () => {
    expect(readArticleTarget("?sensitivity=40")).toBeNull();
  });
});

describe("historyActionFor", () => {
  const titan = { lang: "en" as Lang, title: "Attack on Titan" };
  const sixthSense = { lang: "en" as Lang, title: "The Sixth Sense" };

  it("rewrites the entry the browser already has on the first URL this page writes", () => {
    expect(historyActionFor(undefined, titan)).toBe("replace");
    expect(historyActionFor(undefined, null)).toBe("replace");
  });

  it("gives another article its own entry, so back returns to this one", () => {
    expect(historyActionFor(titan, sixthSense)).toBe("push");
  });

  it("treats the same title in another language as somewhere else", () => {
    expect(historyActionFor({ lang: "en", title: "シックス・センス" }, { lang: "ja", title: "シックス・センス" })).toBe(
      "push",
    );
  });

  it("rewrites the entry in place when the same article is opened again", () => {
    expect(historyActionFor(titan, { ...titan })).toBe("replace");
  });

  it("gives the first article opened from the search screen its own entry", () => {
    expect(historyActionFor(null, titan)).toBe("push");
  });

  it("gives the search screen its own entry when the article closes", () => {
    expect(historyActionFor(titan, null)).toBe("push");
  });

  it("rewrites the entry in place while no article is open", () => {
    expect(historyActionFor(null, null)).toBe("replace");
  });
});
