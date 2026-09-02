import { describe, expect, it } from "vitest";
import { defaultPolicy, type Policy } from "./risk";
import type { Article } from "./segment";
import type { Lang } from "./wikipedia";
import { articleKey, policyForOpened, readSessionStart, scannedElsewhere, scannedForArticle } from "./session";

function article(lang: Lang, title: string): Article {
  return {
    lang,
    title,
    displayTitle: title,
    sourceUrl: `https://${lang}.wikipedia.org/wiki/${title}`,
    sections: [],
  };
}

const usedPolicy: Policy = {
  level: "balanced",
  revealed: ["p1.0"],
  withheld: ["p2.1"],
  alreadyKnows: ["finished season 1"],
  knownSections: [{ sectionId: "s2", because: "finished season 1" }],
  notes: "wants to know nothing about the ending",
};

describe("readSessionStart", () => {
  it("keeps the reader's stored level instead of the level in a shared link", () => {
    const start = readSessionStart("?level=open&title=The%20Sixth%20Sense", "strict");
    expect(start.policy.level).toBe("strict");
  });

  it("takes the level from a shared link when the reader has nothing stored", () => {
    expect(readSessionStart("?level=balanced", null).policy.level).toBe("balanced");
  });

  it("ignores a level that is not one of the three policies", () => {
    expect(readSessionStart("?level=everything", null).policy.level).toBe(defaultPolicy.level);
    expect(readSessionStart("", "everything").policy.level).toBe(defaultPolicy.level);
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
    const next = policyForOpened(usedPolicy, article("en", "Attack on Titan"), article("en", "The Sixth Sense"));
    expect(next).toEqual({ ...defaultPolicy, level: "balanced" });
  });

  it("keeps the reader's level, which is not tied to any article", () => {
    const next = policyForOpened(usedPolicy, article("en", "Attack on Titan"), article("en", "The Sixth Sense"));
    expect(next.level).toBe("balanced");
  });

  it("keeps what the reader has opened when the same article is opened again", () => {
    const open = article("en", "Attack on Titan");
    expect(policyForOpened(usedPolicy, open, article("en", "Attack on Titan"))).toBe(usedPolicy);
  });

  it("treats the same title in another language as another article", () => {
    const next = policyForOpened(usedPolicy, article("en", "The Sixth Sense"), article("ja", "The Sixth Sense"));
    expect(next.revealed).toEqual([]);
  });

  it("clears the previous article's state when the first article is opened", () => {
    expect(policyForOpened(usedPolicy, null, article("en", "The Sixth Sense")).withheld).toEqual([]);
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
