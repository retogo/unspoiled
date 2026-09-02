import { describe, expect, it } from "vitest";
import { segmentArticle } from "./segment";

function article(html: string) {
  return segmentArticle({
    lang: "en",
    title: "Test",
    displayTitle: "Test",
    sourceUrl: "https://en.wikipedia.org/wiki/Test",
    sections: [],
    html: `<div class="mw-parser-output">${html}</div>`,
  });
}

describe("segmentArticle", () => {
  it("puts paragraphs before the first heading into the lead section", () => {
    const result = article(
      "<p>The film was released in 1999 and became a sleeper hit around the world.</p><h2>Plot</h2><p>A boy who sees ghosts meets a child psychologist who tries to help him cope.</p>",
    );
    expect(result.sections.map((section) => section.heading)).toEqual(["(lead)", "Plot"]);
    expect(result.sections[1].paragraphs[0].sentences[0].id).toBe("p1.0");
  });
});
