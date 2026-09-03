import { describe, expect, it } from "vitest";
import { assessSection } from "./risk";
import { segmentArticle } from "./segment";

function sections(html: string) {
  return segmentArticle({
    lang: "en",
    title: "Test",
    displayTitle: "Test",
    sourceUrl: "https://en.wikipedia.org/wiki/Test",
    html: `<div class="mw-parser-output">${html}</div>`,
  }).sections;
}

function prose(text: string) {
  return `<p>${text} It runs long enough to clear the paragraph length filter.</p>`;
}

describe("heading paths", () => {
  it("records the ancestor headings of a subsection", () => {
    const result = sections(
      `<h2>Plot</h2>${prose("The story opens.")}<h3>Season 1</h3>${prose("The first season airs.")}`,
    );
    expect(result.map((section) => section.headingPath)).toEqual([
      ["Plot"],
      ["Plot", "Season 1"],
    ]);
  });

  it("starts a new path at the next same-level heading", () => {
    const result = sections(
      `<h2>Plot</h2>${prose("The story opens.")}<h3>Season 1</h3>${prose("The first season airs.")}` +
        `<h2>Production</h2>${prose("Filming began in Tokyo.")}`,
    );
    expect(result.map((section) => section.headingPath)).toEqual([
      ["Plot"],
      ["Plot", "Season 1"],
      ["Production"],
    ]);
  });

  it("nests a heading under the last shallower heading when a level is skipped", () => {
    const result = sections(
      `<h2>Plot</h2>${prose("The story opens.")}<h4>Season 1</h4>${prose("The first season airs.")}`,
    );
    expect(result.map((section) => section.headingPath)).toEqual([
      ["Plot"],
      ["Plot", "Season 1"],
    ]);
  });

  it("gives the lead section a path of its own", () => {
    const result = sections(prose("The film was released in 1999."));
    expect(result[0].headingPath).toEqual(["(lead)"]);
  });
});

describe("assessSection with ancestor headings", () => {
  it("treats a subsection of a narrative section as a spoiler", () => {
    const result = sections(
      `<h2>Synopsis</h2>${prose("The series is set behind three walls.")}` +
        `<h3>Setting</h3>${prose("Humanity lives inside concentric walls.")}`,
    );
    const setting = result[1];
    expect(setting.heading).toBe("Setting");
    expect(assessSection(setting).level).toBe("spoiler");
  });

  it("leaves a subsection safe when no ancestor heading is narrative", () => {
    const result = sections(
      `<h2>Production</h2>${prose("Filming began in Tokyo.")}` +
        `<h3>Casting</h3>${prose("The lead was cast after an open audition.")}`,
    );
    expect(assessSection(result[1]).level).toBe("safe");
  });
});
