import { describe, expect, it } from "vitest";
import { segmentArticle } from "./segment";
import type { Lang } from "./wikipedia";

function article(html: string, lang: Lang = "en") {
  return segmentArticle({
    lang,
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

  it("keeps an internal link as a run carrying the decoded page title", () => {
    const result = article(
      '<h2>Plot</h2><p>A boy meets a <a href="/wiki/Child_psychologist" title="Child psychologist">child psychologist</a> who tries to help him.</p>',
    );
    expect(result.sections[0].paragraphs[0].sentences[0].runs).toEqual([
      { kind: "text", text: "A boy meets a " },
      { kind: "wiki", text: "child psychologist", title: "Child psychologist" },
      { kind: "text", text: " who tries to help him." },
    ]);
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

  it("keeps an external link as a run carrying its address", () => {
    const result = article(
      '<h2>Release</h2><p>The film opened on August 6, 1999 and was tracked by ' +
        '<a rel="nofollow" class="external text" href="https://www.boxofficemojo.com/release/rl1/">Box Office Mojo</a> all summer.</p>',
    );
    expect(result.sections[0].paragraphs[0].sentences[0].runs).toContainEqual({
      kind: "external",
      text: "Box Office Mojo",
      href: "https://www.boxofficemojo.com/release/rl1/",
    });
  });

  it("keeps a citation marker as a run naming the entry it points at, and out of the text", () => {
    const result = article(
      '<h2>Release</h2><p>The film was a psychological thriller' +
        '<sup id="cite_ref-2" class="reference"><a href="#cite_note-boxofficemojo-1">' +
        '<span class="cite-bracket">[</span>1<span class="cite-bracket">]</span></a></sup>' +
        " written and directed by a first-time director.</p>",
    );
    const sentence = result.sections[0].paragraphs[0].sentences[0];
    expect(sentence.text).toBe(
      "The film was a psychological thriller written and directed by a first-time director.",
    );
    expect(sentence.runs).toContainEqual({ kind: "note", text: "[1]", noteId: "cite_note-boxofficemojo-1" });
  });

  it("joins every run but the notes back into the sentence text", () => {
    const result = article(
      '<h2>Plot</h2><p>A boy meets a <a href="/wiki/Child_psychologist">child psychologist</a>' +
        '<sup class="reference"><a href="#cite_note-4">[4]</a></sup> who reads about ' +
        '<a class="external text" href="https://example.org/">the case</a> in an old file.</p>',
    );
    for (const sentence of result.sections[0].paragraphs[0].sentences) {
      const joined = sentence.runs
        .filter((run) => run.kind !== "note")
        .map((run) => run.text)
        .join("");
      expect(joined).toBe(sentence.text);
    }
  });

  it("leaves a link into a non-article namespace as plain text", () => {
    const result = article(
      '<h2>Release</h2><p>The poster reproduced in <a href="/wiki/File:Sixth_sense.jpg">this file</a> ' +
        "was printed for the American release of the film.</p>",
    );
    expect(result.sections[0].paragraphs[0].sentences[0].runs).toEqual([
      {
        kind: "text",
        text: "The poster reproduced in this file was printed for the American release of the film.",
      },
    ]);
  });

  it("leaves a link to a page that does not exist as plain text", () => {
    const result = article(
      '<h2>Release</h2><p>The film was distributed by <a href="/wiki/Nowhere_Pictures" class="new">Nowhere Pictures</a> ' +
        "in every territory outside North America.</p>",
    );
    expect(result.sections[0].paragraphs[0].sentences[0].runs).toEqual([
      {
        kind: "text",
        text: "The film was distributed by Nowhere Pictures in every territory outside North America.",
      },
    ]);
  });

  it("leaves a link to a heading of this article as plain text", () => {
    const result = article(
      '<h2>Release</h2><p>The reception of the film is described in <a href="#Reception">the section below</a> ' +
        "alongside the box office figures.</p>",
    );
    expect(result.sections[0].paragraphs[0].sentences[0].runs).toEqual([
      {
        kind: "text",
        text: "The reception of the film is described in the section below alongside the box office figures.",
      },
    ]);
  });

  it("cuts runs at a sentence boundary and keeps a marker with the sentence it follows", () => {
    const result = article(
      '<h2>Plot</h2><p>Malcolm is a <a href="/wiki/Child_psychologist">child psychologist</a>.' +
        '<sup class="reference"><a href="#cite_note-9">[9]</a></sup> ' +
        '<a href="/wiki/Cole_Sear">Cole</a> sees ghosts everywhere he goes.</p>',
    );
    const [first, second] = result.sections[0].paragraphs[0].sentences;
    expect(first.runs).toEqual([
      { kind: "text", text: "Malcolm is a " },
      { kind: "wiki", text: "child psychologist", title: "Child psychologist" },
      { kind: "text", text: "." },
      { kind: "note", text: "[9]", noteId: "cite_note-9" },
    ]);
    expect(second.runs).toEqual([
      { kind: "wiki", text: "Cole", title: "Cole Sear" },
      { kind: "text", text: " sees ghosts everywhere he goes." },
    ]);
  });

  it("collects the citation list, dropping the backlinks that lead out of it", () => {
    const result = article(
      '<h2>References</h2><div class="reflist"><ol class="references">' +
        '<li id="cite_note-boxofficemojo-1"><span class="mw-cite-backlink">^ ' +
        '<a href="#cite_ref-boxofficemojo_1-0"><sup><i><b>a</b></i></sup></a></span> ' +
        '<span class="reference-text">Fritz, Ben. <a rel="nofollow" class="external text" ' +
        'href="https://www.boxofficemojo.com/release/rl1/">"The Sixth Sense"</a>. 1999.</span></li>' +
        "</ol></div>",
    );
    expect(result.references).toEqual([
      {
        id: "cite_note-boxofficemojo-1",
        runs: [
          { kind: "text", text: "Fritz, Ben. " },
          { kind: "external", text: '"The Sixth Sense"', href: "https://www.boxofficemojo.com/release/rl1/" },
          { kind: "text", text: ". 1999." },
        ],
      },
    ]);
  });

  it("cuts a Japanese sentence at its full stop and keeps the links on each side", () => {
    const result = article(
      '<h2>あらすじ</h2><p>マルコムは<a href="/wiki/児童心理学">児童心理学</a>の専門家である。' +
        '<sup class="reference"><a href="#cite_note-3">[3]</a></sup>' +
        'コールは<a href="/wiki/幽霊">幽霊</a>が見えると訴える少年で、母親と二人で暮らしていた。</p>',
      "ja",
    );
    const [first, second] = result.sections[0].paragraphs[0].sentences;
    expect(first.runs).toEqual([
      { kind: "text", text: "マルコムは" },
      { kind: "wiki", text: "児童心理学", title: "児童心理学" },
      { kind: "text", text: "の専門家である。" },
      { kind: "note", text: "[3]", noteId: "cite_note-3" },
    ]);
    expect(second.text).toBe("コールは幽霊が見えると訴える少年で、母親と二人で暮らしていた。");
    expect(second.runs[1]).toEqual({ kind: "wiki", text: "幽霊", title: "幽霊" });
  });

  it("drops the backlinks of a citation that carries no wrapper around them", () => {
    const result = article(
      '<h2>脚注</h2><div class="reflist"><ol class="references">' +
        '<li id="cite_note-boxoffice-1">^ <a href="#cite_ref-boxoffice_1-0"><sup><i><b>a</b></i></sup></a> ' +
        '<a href="#cite_ref-boxoffice_1-1"><sup><i><b>b</b></i></sup></a> ' +
        '<span class="reference-text"><cite class="citation web">“<a rel="nofollow" class="external text" ' +
        'href="https://www.boxofficemojo.com/release/rl1/">The Sixth Sense (1999)</a>”。2010年2月5日閲覧。</cite></span>' +
        "</li></ol></div>",
      "ja",
    );
    expect(result.references).toEqual([
      {
        id: "cite_note-boxoffice-1",
        runs: [
          { kind: "text", text: "“" },
          { kind: "external", text: "The Sixth Sense (1999)", href: "https://www.boxofficemojo.com/release/rl1/" },
          { kind: "text", text: "”。2010年2月5日閲覧。" },
        ],
      },
    ]);
  });
});
