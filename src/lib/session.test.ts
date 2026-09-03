import { describe, expect, it } from "vitest";
import { DEFAULT_SENSITIVITY, type Policy } from "./risk";
import type { Article } from "./segment";
import type { Lang } from "./wikipedia";
import {
  articleKey,
  historyActionFor,
  policyForOpened,
  readArticleTarget,
  readSessionStart,
  recordScanned,
  scannedElsewhere,
  scannedForArticle,
} from "./session";

function article(lang: Lang, title: string): Article {
  return {
    lang,
    title,
    displayTitle: title,
    sourceUrl: `https://${lang}.wikipedia.org/wiki/${title}`,
    sections: [],
    references: [],
  };
}

const usedPolicy: Policy = {
  sensitivity: 50,
  shown: new Set(["p1.0"]),
  hidden: new Set(["p2.1"]),
  decisions: [
    {
      at: 0,
      articleKey: articleKey("en", "Attack on Titan"),
      articleTitle: "Attack on Titan",
      show: ["p1.0"],
      hide: ["p2.1"],
      reason: "you have watched the first season",
    },
  ],
};

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
    const next = policyForOpened(usedPolicy, article("en", "Attack on Titan"), article("en", "The Sixth Sense"));
    expect(next.shown.size).toBe(0);
    expect(next.hidden.size).toBe(0);
  });

  it("keeps the log of what the agent decided, which is a record of the session and not of one article", () => {
    const next = policyForOpened(usedPolicy, article("en", "Attack on Titan"), article("en", "The Sixth Sense"));
    expect(next.decisions).toEqual(usedPolicy.decisions);
  });

  it("keeps the reader's sensitivity, which is not tied to any article", () => {
    const next = policyForOpened(usedPolicy, article("en", "Attack on Titan"), article("en", "The Sixth Sense"));
    expect(next.sensitivity).toBe(50);
  });

  it("keeps what the reader has opened when the same article is opened again", () => {
    const open = article("en", "Attack on Titan");
    expect(policyForOpened(usedPolicy, open, article("en", "Attack on Titan"))).toBe(usedPolicy);
  });

  it("treats the same title in another language as another article", () => {
    const next = policyForOpened(usedPolicy, article("en", "The Sixth Sense"), article("ja", "The Sixth Sense"));
    expect(next.shown.size).toBe(0);
  });

  it("clears the previous article's state when the first article is opened", () => {
    expect(policyForOpened(usedPolicy, null, article("en", "The Sixth Sense")).hidden.size).toBe(0);
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

describe("the record of what the agent has read", () => {
  const open = article("en", "Attack on Titan");
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
