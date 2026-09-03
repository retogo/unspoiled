import { describe, expect, it } from "vitest";
import { segmentArticle } from "./segment";

function article(html: string) {
  return segmentArticle({
    lang: "en",
    title: "Test",
    displayTitle: "Test",
    sourceUrl: "https://en.wikipedia.org/wiki/Test",
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

  it("collects list items as paragraphs", () => {
    const result = article(
      '<h2>Episodes</h2><ul><li>"To You, in 2000 Years"</li><li>"That Day"</li></ul>',
    );
    expect(result.sections[0].paragraphs.map((paragraph) => paragraph.sentences[0].text)).toEqual([
      '"To You, in 2000 Years"',
      '"That Day"',
    ]);
  });

  it("collects definition terms and descriptions as paragraphs", () => {
    const result = article(
      "<h2>Plot</h2><dl><dt>The fall of Wall Maria</dt><dd>A colossal titan breaks the gate.</dd></dl>",
    );
    expect(result.sections[0].paragraphs.map((paragraph) => paragraph.sentences[0].text)).toEqual([
      "The fall of Wall Maria",
      "A colossal titan breaks the gate.",
    ]);
  });

  it("keeps a nested list item out of its parent item", () => {
    const result = article(
      "<h2>Media</h2><ul><li>Anime series<ul><li>Season 1</li></ul></li></ul>",
    );
    expect(result.sections[0].paragraphs.map((paragraph) => paragraph.sentences[0].text)).toEqual([
      "Anime series",
      "Season 1",
    ]);
  });

  it("collects a table row as one paragraph with a sentence per cell", () => {
    const result = article(
      '<h2>Episodes</h2><table class="wikitable"><tbody>' +
        "<tr><th>No.</th><th>Title</th></tr>" +
        '<tr><th scope="row">1</th><td>"To You, in 2000 Years"</td></tr>' +
        "</tbody></table>",
    );
    expect(result.sections[0].paragraphs).toHaveLength(1);
    expect(result.sections[0].paragraphs[0].sentences.map((sentence) => sentence.text)).toEqual([
      "1",
      '"To You, in 2000 Years"',
    ]);
  });

  it("splits sentences inside a long table cell", () => {
    const result = article(
      '<h2>Episodes</h2><table class="wikitable"><tbody><tr><td>1</td>' +
        '<td class="description">Eren joins the cadets. He learns the truth about his father.</td>' +
        "</tr></tbody></table>",
    );
    expect(result.sections[0].paragraphs[0].sentences.map((sentence) => sentence.text)).toEqual([
      "1",
      "Eren joins the cadets.",
      "He learns the truth about his father.",
    ]);
  });

  it("keeps a section whose only content is a table", () => {
    const result = article(
      '<h2>Episode list</h2><table class="wikitable"><tbody>' +
        '<tr><td>"To You, in 2000 Years"</td></tr></tbody></table>',
    );
    expect(result.sections.map((section) => section.heading)).toEqual(["Episode list"]);
  });

  it("skips infoboxes, hatnotes, navboxes, references and image captions", () => {
    const result = article(
      '<table class="infobox"><tbody><tr><th>Directed by</th><td>M. Night Shyamalan</td></tr></tbody></table>' +
        '<div class="hatnote">For the novel, see The Sixth Sense (novel).</div>' +
        "<p>The film was released in 1999 and became a sleeper hit around the world.</p>" +
        '<figure><figcaption>Bruce Willis at the premiere of the film in 1999.</figcaption></figure>' +
        '<div class="reflist"><ol class="references"><li>Ebert, Roger. "The Sixth Sense". 1999.</li></ol></div>' +
        '<div class="navbox"><table class="navbox-inner"><tbody><tr><td>Films directed by M. Night Shyamalan</td></tr></tbody></table></div>',
    );
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].paragraphs.map((paragraph) => paragraph.sentences[0].text)).toEqual([
      "The film was released in 1999 and became a sleeper hit around the world.",
    ]);
  });

  it("drops citation markers from the text", () => {
    const result = article(
      '<h2>Plot</h2><p>Malcolm is shot by a former patient<sup class="reference">[note 3]</sup> ' +
        "in the opening scene of the film.</p>",
    );
    expect(result.sections[0].paragraphs[0].sentences[0].text).toBe(
      "Malcolm is shot by a former patient in the opening scene of the film.",
    );
  });

  it("separates lines broken by <br> and drops hidden metadata", () => {
    const result = article(
      '<h2>Episodes</h2><table class="wikitable"><tbody><tr>' +
        '<td class="summary">"That Day"<br />Transliteration: "Sono Hi"</td>' +
        '<td>April 14, 2013<span style="display: none;"> (<span class="bday">2013-04-14</span>)</span></td>' +
        "</tr></tbody></table>",
    );
    expect(result.sections[0].paragraphs[0].sentences.map((sentence) => sentence.text)).toEqual([
      '"That Day" Transliteration: "Sono Hi"',
      "April 14, 2013",
    ]);
  });
});
