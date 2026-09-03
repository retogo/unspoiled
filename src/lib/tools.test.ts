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
        heading: "Series finale",
        headingPath: ["Series finale"],
        level: 2,
        paragraphs: [paragraph("p4", ["A cinema re-release followed in 2019."])],
      },
    ],
  };
}

function harness() {
  let policy: Policy = newPolicy();
  const scanned: string[] = [];
  const sent: string[] = [];
  const article = fightClub();
  const tools = buildTools({
    article: () => article,
    policy: () => policy,
    setPolicy: (next) => {
      policy = next;
    },
    openArticle: () => Promise.resolve({ status: "opened", article, policy }),
    scanned: () => scanned,
    sent: () => sent,
    markScanned: (_article, sectionId, disclosed) => {
      if (!scanned.includes(sectionId)) scanned.push(sectionId);
      for (const id of disclosed) if (!sent.includes(id)) sent.push(id);
    },
  });

  return {
    call: (name: string, input: Record<string, unknown> = {}) => {
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`No such tool: ${name}`);
      return tool.execute(input) as Record<string, never>;
    },
    policy: () => policy,
    scanned,
    sent,
  };
}

function sectionOf(result: Record<string, never>, id: string) {
  return (result.sections as unknown as { section_id: string }[]).find((section) => section.section_id === id) as Record<
    string,
    unknown
  >;
}

describe("withheld headings", () => {
  it("gives the agent the id it needs to reveal a withheld heading", () => {
    const { call } = harness();
    expect(sectionOf(call("get_article_outline"), "s3")).toMatchObject({
      heading: null,
      heading_id: "s3.heading",
    });
  });

  it("names the heading id in describe_withheld_content too", () => {
    const { call } = harness();
    expect(call("describe_withheld_content", { section_id: "s3" })).toMatchObject({
      heading: null,
      heading_id: "s3.heading",
    });
  });

  it("does not offer a heading id for a heading that is on screen", () => {
    const { call } = harness();
    expect(sectionOf(call("get_article_outline"), "s2").heading_id).toBeUndefined();
  });

  it("withholds the heading when the agent withholds the section", () => {
    const { call } = harness();
    call("withhold_article_content", { section_ids: ["s2"], because: "the reader has not seen the film" });
    expect(sectionOf(call("get_article_outline"), "s2")).toMatchObject({
      heading: null,
      heading_id: "s2.heading",
    });
  });

  it("withholds a heading the agent names by id", () => {
    const { call } = harness();
    call("withhold_article_content", { sentence_ids: ["s0.heading"], because: "the title gives it away" });
    expect(sectionOf(call("get_article_outline"), "s0").heading).toBeNull();
  });

  it("puts a withheld heading back on screen when revealed", () => {
    const { call } = harness();
    expect(call("reveal_withheld_sentences", { sentence_ids: ["s3.heading"] })).toMatchObject({
      revealed: [{ sentence_id: "s3.heading", text: "Series finale" }],
    });
    expect(sectionOf(call("get_article_outline"), "s3").heading).toBe("Series finale");
  });

  it("never states a withheld heading in a reason", () => {
    const { call } = harness();
    const described = call("describe_withheld_content", { section_id: "s3" });
    expect(JSON.stringify(described)).not.toContain("finale");
  });
});

describe("what mark_sections_known claims to unhide", () => {
  it("really unhides sentences the agent had withheld", () => {
    const { call } = harness();
    call("withhold_article_content", { section_ids: ["s1"], because: "the reader has not seen the film" });
    call("mark_sections_known", { section_ids: ["s1"], because: "you read the novel" });
    const text = call("get_visible_section_text", { section_id: "s1" });
    expect(JSON.stringify(text)).toContain("The narrator attends support groups.");
  });
});

describe("the middle of the scale withholds the reveal in a reception section", () => {
  it("hides the twist sentence but keeps the box office", () => {
    const { call } = harness();
    call("set_spoiler_policy", { sensitivity: 50 });
    const text = JSON.stringify(call("get_visible_section_text", { section_id: "s2" }));
    expect(text).not.toContain("Tyler are one man");
    expect(text).toContain("101 million dollars");
  });
});

describe("set_spoiler_policy", () => {
  it("applies the sensitivity the agent asked for", () => {
    const { call, policy } = harness();
    expect(call("set_spoiler_policy", { sensitivity: 20 })).toMatchObject({ applied: 20 });
    expect(policy().sensitivity).toBe(20);
  });

  it("reports the sensitivity back through the outline", () => {
    const { call } = harness();
    call("set_spoiler_policy", { sensitivity: 40 });
    expect(call("get_article_outline").sensitivity).toBe(40);
  });

  it.each([-1, 101, 62.5, "50", null, undefined])("refuses %s, which is not a point on the scale", (sensitivity) => {
    const { call, policy } = harness();
    expect(() => call("set_spoiler_policy", { sensitivity })).toThrow(/0 to 100/);
    expect(policy().sensitivity).toBe(newPolicy().sensitivity);
  });

  it("accepts both ends of the scale", () => {
    const { call, policy } = harness();
    call("set_spoiler_policy", { sensitivity: 0 });
    expect(policy().sensitivity).toBe(0);
    call("set_spoiler_policy", { sensitivity: 100 });
    expect(policy().sensitivity).toBe(100);
  });

  it("keeps what the reader already knows when only the sensitivity moves", () => {
    const { call, policy } = harness();
    call("set_spoiler_policy", { sensitivity: 50, already_knows: ["read the original manga"] });
    call("set_spoiler_policy", { sensitivity: 20 });
    expect(policy().alreadyKnows).toEqual(["read the original manga"]);
  });
});

describe("describe_withheld_content", () => {
  it("scores each withheld sentence so the agent can say how far to lower the slider", () => {
    const { call } = harness();
    const hidden = call("describe_withheld_content", { section_id: "s1" }).hidden as unknown as {
      sentence_id: string;
      risk: number;
    }[];
    expect(hidden.map((item) => item.risk)).toEqual([60, 80, 100]);
  });

  it("stops describing a sentence once the reader has lowered the slider past it", () => {
    const { call } = harness();
    call("set_spoiler_policy", { sensitivity: 35 });
    const hidden = call("describe_withheld_content", { section_id: "s1" }).hidden as unknown as { risk: number }[];
    expect(hidden.map((item) => item.risk)).toEqual([80, 100]);
  });
});

describe("get_masking_report", () => {
  it("states the policy in a shape the agent can read back", () => {
    const { call } = harness();
    call("set_spoiler_policy", { sensitivity: 50 });
    call("withhold_article_content", { sentence_ids: ["p0.0"], because: "the reader asked" });
    call("mark_sections_known", { section_ids: ["s2"], because: "you have seen it" });
    expect(call("get_masking_report").policy).toEqual({
      sensitivity: 50,
      revealed: [],
      withheld: ["p0.0"],
      already_knows: [],
      known_sections: [{ section_id: "s2", because: "you have seen it" }],
      notes: "the reader asked",
    });
  });
});

describe("reveal is a disclosure the reader can see", () => {
  it("lists the section on screen once the agent reads withheld text", () => {
    const { call, scanned } = harness();
    call("reveal_withheld_sentences", { sentence_ids: ["p1.0", "p1.1"] });
    expect(scanned).toEqual(["s1"]);
    expect(call("get_masking_report").sections_the_agent_has_read).toEqual(["s1"]);
  });

  it("stays quiet when the sentences were already on screen", () => {
    const { call, scanned } = harness();
    call("reveal_withheld_sentences", { sentence_ids: ["p0.0"] });
    expect(scanned).toEqual([]);
  });

  it("lists the section when the agent reveals a withheld heading", () => {
    const { call, scanned } = harness();
    call("reveal_withheld_sentences", { sentence_ids: ["s3.heading"] });
    expect(scanned).toEqual(["s3"]);
  });
});

describe("the ledger of text that reached the agent", () => {
  it("records the sentences a reveal took out of the mask", () => {
    const { call, sent } = harness();
    call("reveal_withheld_sentences", { sentence_ids: ["p1.0", "p1.1"] });
    expect(sent).toEqual(["p1.0", "p1.1"]);
  });

  it("records nothing for a sentence that was already on screen", () => {
    const { call, sent } = harness();
    call("reveal_withheld_sentences", { sentence_ids: ["p0.0"] });
    expect(sent).toEqual([]);
  });

  it("records a withheld heading the agent revealed", () => {
    const { call, sent } = harness();
    call("reveal_withheld_sentences", { sentence_ids: ["s3.heading"] });
    expect(sent).toEqual(["s3.heading"]);
  });

  it("records every sentence of a section read in full", () => {
    const { call, sent } = harness();
    call("read_withheld_section", { section_id: "s1", acknowledge: true });
    expect(sent).toEqual(["p1.0", "p1.1", "p2.0"]);
  });

  it("records the heading of a section read in full when the page was withholding it", () => {
    const { call, sent } = harness();
    call("read_withheld_section", { section_id: "s3", acknowledge: true });
    expect(sent).toEqual(["s3.heading", "p4.0"]);
  });

  it("records nothing when read_withheld_section refuses", () => {
    const { call, sent, scanned } = harness();
    call("read_withheld_section", { section_id: "s1", acknowledge: false });
    expect(sent).toEqual([]);
    expect(scanned).toEqual([]);
  });

  it("reports what is open on the page apart from what was sent", () => {
    const { call } = harness();
    call("reveal_withheld_sentences", { sentence_ids: ["p1.0"] });
    call("read_withheld_section", { section_id: "s2", acknowledge: true });
    const report = call("get_masking_report");
    expect(report.revealed_on_page).toEqual(["p1.0"]);
    expect(report.text_sent_to_agent).toEqual(["p1.0", "p3.0", "p3.1"]);
  });

  it("names no withheld heading in either ledger", () => {
    const { call } = harness();
    call("read_withheld_section", { section_id: "s3", acknowledge: true });
    expect(JSON.stringify(call("get_masking_report"))).not.toContain("finale");
  });
});
