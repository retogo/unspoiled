import { describe, expect, it } from "vitest";
import type { Article, Paragraph } from "./segment";
import { newPolicy, type Policy } from "./risk";
import { buildTools } from "./tools";

function paragraph(id: string, texts: string[]): Paragraph {
  return {
    id,
    sentences: texts.map((text, index) => ({ id: `${id}.${index}`, text, runs: [{ kind: "text", text }] })),
  };
}

function fightClub(): Article {
  return {
    lang: "en",
    title: "Fight Club (film)",
    displayTitle: "Fight Club (film)",
    sourceUrl: "https://en.wikipedia.org/wiki/Fight_Club_(film)",
    references: [],
    sections: [
      {
        id: "s0",
        heading: "(lead)",
        headingPath: ["(lead)"],
        level: 2,
        paragraphs: [paragraph("p0", ["The film was released in 1999."])],
      },
      {
        id: "s1",
        heading: "Plot",
        headingPath: ["Plot"],
        level: 2,
        paragraphs: [
          paragraph("p1", ["The narrator attends support groups.", "He meets a soap salesman on a flight."]),
          paragraph("p2", ["They start a club in the basement of a bar."]),
        ],
      },
      {
        id: "s2",
        heading: "Reception",
        headingPath: ["Reception"],
        level: 2,
        paragraphs: [
          paragraph("p3", [
            "Reviewers dwelt on the twist, that the narrator and Tyler are one man.",
            "The film earned 101 million dollars worldwide.",
          ]),
        ],
      },
      {
        id: "s3",
        heading: "Home media",
        headingPath: ["Home media"],
        level: 2,
        paragraphs: [paragraph("p4", ["A cinema re-release followed in 2019."])],
      },
    ],
  };
}

function harness(sensitivity?: number) {
  let policy: Policy = newPolicy(sensitivity);
  const read: string[] = [];
  const article = fightClub();
  const tools = buildTools({
    article: () => article,
    policy: () => policy,
    setPolicy: (next) => {
      policy = next;
    },
    openArticle: () => Promise.resolve({ status: "opened", article, policy }),
    scanned: () => read,
    markScanned: (_article, sectionIds) => {
      for (const id of sectionIds) if (!read.includes(id)) read.push(id);
    },
  });

  const call = (name: string, input: Record<string, unknown> = {}) => {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`No such tool: ${name}`);
    return tool.execute(input) as Record<string, never>;
  };

  return {
    tools,
    call,
    /** Opening an article is the one asynchronous tool, even when it only describes the open one. */
    outline: async (input: Record<string, unknown> = {}) =>
      (await call("open_article", input)) as unknown as Record<string, never>,
    policy: () => policy,
    read,
  };
}

type OutlineSection = {
  section_id: string;
  heading: string;
  heading_path: string[];
  risk: string;
  sentences: number;
  withheld: number;
  paragraph_ids: string[];
};

function sections(result: Record<string, never>): OutlineSection[] {
  return result.sections as unknown as OutlineSection[];
}

function sectionOf(result: Record<string, never>, id: string): OutlineSection {
  const found = sections(result).find((section) => section.section_id === id);
  if (!found) throw new Error(`No section ${id} in the outline`);
  return found;
}

type ReadSentence = { sentence_id: string; text: string; shown: boolean };

function sentencesOf(result: Record<string, never>, sectionId: string): ReadSentence[] {
  const sections = result.sections as unknown as {
    section_id: string;
    paragraphs: { paragraph_id: string; sentences: ReadSentence[] }[];
  }[];
  const found = sections.find((section) => section.section_id === sectionId);
  if (!found) throw new Error(`No section ${sectionId} in the content`);
  return found.paragraphs.flatMap((entry) => entry.sentences);
}

describe("the tools the page offers", () => {
  it("offers four, named for what each one does to the page", () => {
    expect(harness().tools.map((tool) => tool.name)).toEqual([
      "open_article",
      "read_article_content",
      "apply_mask",
      "get_masking_report",
    ]);
  });

  it("tells the agent which call comes next in every description", () => {
    for (const tool of harness().tools) {
      expect(tool.description).toMatch(/open_article|read_article_content|apply_mask|get_masking_report/);
    }
  });
});

describe("open_article", () => {
  it("describes each section without withholding its heading", async () => {
    expect(sectionOf(await harness().outline(), "s1")).toEqual({
      section_id: "s1",
      heading: "Plot",
      heading_path: ["Plot"],
      risk: "spoiler",
      sentences: 3,
      withheld: 3,
      paragraph_ids: ["p1", "p2"],
    });
  });

  it("counts what the reader is currently being shown, not what the rules would withhold", async () => {
    const { call, outline: describe } = harness();
    call("apply_mask", { show: { section_ids: ["s1"] }, reason: "you have watched it all" });
    expect(sectionOf(await describe(), "s1").withheld).toBe(0);
  });

  it("names the lead section rather than inventing a heading for it", async () => {
    expect(sectionOf(await harness().outline(), "s0").heading).toBe("Lead section");
    expect(sectionOf(await harness().outline(), "s0").heading_path).toEqual(["Lead section"]);
  });

  it("reports the article a bare call is describing", async () => {
    const result = await harness().outline();
    expect(result.title).toBe("Fight Club (film)");
    expect(result.lang).toBe("en");
    expect(result.source_url).toBe("https://en.wikipedia.org/wiki/Fight_Club_(film)");
  });
});

describe("read_article_content", () => {
  it("hands over a withheld section in full, saying which of it the reader can see", () => {
    const sentences = sentencesOf(harness().call("read_article_content", { section_ids: ["s1"] }), "s1");
    expect(sentences).toEqual([
      { sentence_id: "p1.0", text: "The narrator attends support groups.", shown: false },
      { sentence_id: "p1.1", text: "He meets a soap salesman on a flight.", shown: false },
      { sentence_id: "p2.0", text: "They start a club in the basement of a bar.", shown: false },
    ]);
  });

  it("keeps the paragraphs apart, under the ids apply_mask takes", () => {
    const result = harness().call("read_article_content", { section_ids: ["s1"] });
    const paragraphs = (result.sections as unknown as { paragraphs: { paragraph_id: string }[] }[])[0].paragraphs;
    expect(paragraphs.map((entry) => entry.paragraph_id)).toEqual(["p1", "p2"]);
  });

  it("says a sentence is shown once a decision has opened it", () => {
    const { call } = harness();
    call("apply_mask", { show: { sentence_ids: ["p1.0"] }, reason: "you have seen the first act" });
    expect(sentencesOf(call("read_article_content", { section_ids: ["s1"] }), "s1")[0].shown).toBe(true);
  });

  it("reads the whole article when no section is named", () => {
    const result = harness().call("read_article_content");
    expect(sections(result).map((section) => section.section_id)).toEqual(["s0", "s1", "s2", "s3"]);
  });

  it("lists what it read where the reader can see it", () => {
    const { call, read } = harness();
    call("read_article_content", { section_ids: ["s1", "s2"] });
    expect(read).toEqual(["s1", "s2"]);
    expect(call("get_masking_report").sections_read).toEqual(["s1", "s2"]);
  });

  it("refuses a section id the article does not have", () => {
    expect(() => harness().call("read_article_content", { section_ids: ["s9"] })).toThrow(/s9/);
  });
});

describe("apply_mask", () => {
  it("withholds a sentence the wording rules found nothing wrong with", () => {
    const { call } = harness();
    call("apply_mask", { hide: { sentence_ids: ["p4.0"] }, reason: "it names the actor you asked about" });
    expect(sentencesOf(call("read_article_content", { section_ids: ["s3"] }), "s3")[0].shown).toBe(false);
  });

  it("keeps withholding it at the sensitivity that withholds nothing else", async () => {
    const { call, outline: describe } = harness(0);
    call("apply_mask", { hide: { sentence_ids: ["p4.0"] }, reason: "it names the actor you asked about" });
    expect(sectionOf(await describe(), "s3").withheld).toBe(1);
  });

  it("opens a sentence the wording rules withheld", async () => {
    const { call, outline: describe } = harness();
    call("apply_mask", { show: { sentence_ids: ["p1.0"] }, reason: "it is the opening scene" });
    expect(sectionOf(await describe(), "s1").withheld).toBe(2);
  });

  it("spreads a section over the sentences in it", async () => {
    const { call, outline: describe } = harness();
    call("apply_mask", { show: { section_ids: ["s1"] }, reason: "you have read the novel" });
    expect(sectionOf(await describe(), "s1").withheld).toBe(0);
  });

  it("spreads a paragraph over the sentences in it", async () => {
    const { call, outline: describe } = harness();
    call("apply_mask", { show: { paragraph_ids: ["p1"] }, reason: "you have watched the first act" });
    expect(sectionOf(await describe(), "s1").withheld).toBe(1);
  });

  it("withholds a sentence named on both sides of one call", async () => {
    const { call, outline: describe } = harness();
    call("apply_mask", {
      show: { section_ids: ["s1"] },
      hide: { sentence_ids: ["p2.0"] },
      reason: "you have watched up to the bar",
    });
    expect(sectionOf(await describe(), "s1").withheld).toBe(1);
  });

  it("lets a later call take back what an earlier one decided", async () => {
    const { call, outline: describe } = harness();
    call("apply_mask", { hide: { sentence_ids: ["p4.0"] }, reason: "you asked not to know" });
    call("apply_mask", { show: { sentence_ids: ["p4.0"] }, reason: "you have changed your mind" });
    expect(sectionOf(await describe(), "s3").withheld).toBe(0);
  });

  it("refuses a call that gives no reason", () => {
    const { call, policy } = harness();
    expect(() => call("apply_mask", { hide: { sentence_ids: ["p4.0"] } })).toThrow(/reason/);
    expect(policy().hidden.size).toBe(0);
  });

  it("refuses a reason that is only spaces", () => {
    expect(() => harness().call("apply_mask", { hide: { sentence_ids: ["p4.0"] }, reason: "   " })).toThrow(/reason/);
  });

  it("names the ids it could not find, rather than failing the call", () => {
    const { call } = harness();
    const result = call("apply_mask", {
      hide: { section_ids: ["s9"], paragraph_ids: ["p9"], sentence_ids: ["p9.9"] },
      reason: "you asked not to know how it ends",
    });
    expect(result).toMatchObject({
      matched: { shown: 0, hidden: 0 },
      unknown_ids: ["s9", "p9", "p9.9"],
    });
  });

  it("records a decision that reached nothing, so the reader sees it was made", () => {
    const { call } = harness();
    call("apply_mask", { hide: { sentence_ids: ["p9.9"] }, reason: "you asked not to know how it ends" });
    expect(call("get_masking_report").decisions).toMatchObject([
      { show: [], hide: [], reason: "you asked not to know how it ends" },
    ]);
  });

  it("records a decision that changed nothing, because the sentence was already shown", () => {
    const { call } = harness();
    const before = call("get_masking_report").sentences;
    const result = call("apply_mask", { show: { sentence_ids: ["p0.0"] }, reason: "you have read the lead" });
    expect(result).toMatchObject({ matched: { shown: 1, hidden: 0 }, unknown_ids: [], sentences: before });
    expect(call("get_masking_report").decisions).toHaveLength(1);
  });

  it("records only what it did, where a sentence was named on both sides", () => {
    const { call } = harness();
    const result = call("apply_mask", {
      show: { paragraph_ids: ["p1"] },
      hide: { sentence_ids: ["p1.1"] },
      reason: "you have watched the opening scene only",
    });
    expect(result).toMatchObject({ show: ["p1.0"], hide: ["p1.1"] });
    expect(call("get_masking_report").decisions).toMatchObject([{ show: ["p1.0"], hide: ["p1.1"] }]);
  });

  it("reports what it reached, so the agent can check its own decision", () => {
    const result = harness().call("apply_mask", {
      show: { paragraph_ids: ["p1"] },
      hide: { sentence_ids: ["p3.0"] },
      reason: "you have watched the first act",
    });
    expect(result).toMatchObject({
      show: ["p1.0", "p1.1"],
      hide: ["p3.0"],
      reason: "you have watched the first act",
    });
  });
});

describe("get_masking_report", () => {
  it("counts every sentence of the article as shown or withheld", () => {
    expect(harness().call("get_masking_report").sentences).toEqual({ total: 7, shown: 3, hidden: 4 });
  });

  it("states the sensitivity the reader's slider is on", () => {
    expect(harness(50).call("get_masking_report").sensitivity).toBe(50);
  });

  it("keeps every decision and the reason given for it", () => {
    const { call } = harness();
    call("apply_mask", { show: { paragraph_ids: ["p1"] }, reason: "you have watched the first act" });
    call("apply_mask", { hide: { sentence_ids: ["p3.0"] }, reason: "you asked not to know the twist" });
    const decisions = call("get_masking_report").decisions as unknown as {
      show: string[];
      hide: string[];
      reason: string;
    }[];
    expect(decisions.map(({ show, hide, reason }) => ({ show, hide, reason }))).toEqual([
      { show: ["p1.0", "p1.1"], hide: [], reason: "you have watched the first act" },
      { show: [], hide: ["p3.0"], reason: "you asked not to know the twist" },
    ]);
  });

  it("returns no article text, so the report can be read out to the reader", () => {
    const { call } = harness();
    call("read_article_content");
    call("apply_mask", { hide: { sentence_ids: ["p3.0"] }, reason: "you asked not to know the twist" });
    expect(JSON.stringify(call("get_masking_report"))).not.toContain("Tyler");
  });
});
