import { describe, expect, it } from "vitest";
import type { Article, Paragraph } from "./segment";
import { defaultPolicy, type Policy } from "./risk";
import { buildTools } from "./tools";

function paragraph(id: string, texts: string[]): Paragraph {
  return { id, sentences: texts.map((text, index) => ({ id: `${id}.${index}`, text })) };
}

function fightClub(): Article {
  return {
    lang: "en",
    title: "Fight Club (film)",
    displayTitle: "Fight Club (film)",
    sourceUrl: "https://en.wikipedia.org/wiki/Fight_Club_(film)",
    sections: [
      { id: "s0", heading: "(lead)", level: 2, paragraphs: [paragraph("p0", ["The film was released in 1999."])] },
      {
        id: "s1",
        heading: "Plot",
        level: 2,
        paragraphs: [
          paragraph("p1", ["The narrator attends support groups.", "He meets a soap salesman on a flight."]),
          paragraph("p2", ["They start a club in the basement of a bar."]),
        ],
      },
      {
        id: "s2",
        heading: "Reception",
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
        level: 2,
        paragraphs: [paragraph("p4", ["A cinema re-release followed in 2019."])],
      },
    ],
  };
}

function harness() {
  let policy: Policy = defaultPolicy;
  const scanned: string[] = [];
  const article = fightClub();
  const tools = buildTools({
    article: () => article,
    policy: () => policy,
    setPolicy: (next) => {
      policy = next;
    },
    openArticle: () => {},
    scanned: () => scanned,
    markScanned: (sectionId) => {
      if (!scanned.includes(sectionId)) scanned.push(sectionId);
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

  it("names the heading id in describe_hidden too", () => {
    const { call } = harness();
    expect(call("describe_hidden", { section_id: "s3" })).toMatchObject({
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
    call("withhold", { section_ids: ["s2"], because: "the reader has not seen the film" });
    expect(sectionOf(call("get_article_outline"), "s2")).toMatchObject({
      heading: null,
      heading_id: "s2.heading",
    });
  });

  it("withholds a heading the agent names by id", () => {
    const { call } = harness();
    call("withhold", { sentence_ids: ["s0.heading"], because: "the title gives it away" });
    expect(sectionOf(call("get_article_outline"), "s0").heading).toBeNull();
  });

  it("puts a withheld heading back on screen when revealed", () => {
    const { call } = harness();
    expect(call("reveal", { sentence_ids: ["s3.heading"] })).toMatchObject({
      revealed: [{ sentence_id: "s3.heading", text: "Series finale" }],
    });
    expect(sectionOf(call("get_article_outline"), "s3").heading).toBe("Series finale");
  });

  it("never states a withheld heading in a reason", () => {
    const { call } = harness();
    const described = call("describe_hidden", { section_id: "s3" });
    expect(JSON.stringify(described)).not.toContain("finale");
  });
});

describe("what mark_known_sections claims to unhide", () => {
  it("really unhides sentences the agent had withheld", () => {
    const { call } = harness();
    call("withhold", { section_ids: ["s1"], because: "the reader has not seen the film" });
    call("mark_known_sections", { section_ids: ["s1"], because: "you read the novel" });
    const text = call("get_safe_text", { section_id: "s1" });
    expect(JSON.stringify(text)).toContain("The narrator attends support groups.");
  });
});

describe("balanced withholds the reveal in a reception section", () => {
  it("hides the twist sentence but keeps the box office", () => {
    const { call } = harness();
    call("set_spoiler_policy", { level: "balanced" });
    const text = JSON.stringify(call("get_safe_text", { section_id: "s2" }));
    expect(text).not.toContain("Tyler are one man");
    expect(text).toContain("101 million dollars");
  });
});

describe("reveal is a disclosure the reader can see", () => {
  it("lists the section on screen once the agent reads withheld text", () => {
    const { call, scanned } = harness();
    call("reveal", { sentence_ids: ["p1.0", "p1.1"] });
    expect(scanned).toEqual(["s1"]);
    expect(call("get_masking_report").sections_the_agent_has_read).toEqual(["s1"]);
  });

  it("stays quiet when the sentences were already on screen", () => {
    const { call, scanned } = harness();
    call("reveal", { sentence_ids: ["p0.0"] });
    expect(scanned).toEqual([]);
  });

  it("lists the section when the agent reveals a withheld heading", () => {
    const { call, scanned } = harness();
    call("reveal", { sentence_ids: ["s3.heading"] });
    expect(scanned).toEqual(["s3"]);
  });
});
