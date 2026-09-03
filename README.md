# Unspoiled

**Read Wikipedia without learning the ending.**

Wikipedia does not use spoiler warnings. That is a deliberate, long-standing policy — the
spoiler warning template was removed in 2007 after a lengthy debate — so the plot section of
every film, series and novel article states the ending as plainly as it states the release date.
There is no setting to turn that off, and there never will be.

Unspoiled is a Wikipedia reader that withholds the parts you do not want yet, and exposes that
filtering to your AI agent as WebMCP tools.

## Why this needs WebMCP

An agent can already answer questions about a film. What it cannot do is change what you are
looking at. The value here lives in the page — which sentences you see — and a chat reply cannot
deliver it.

The division of labour is the point:

- **The page knows the article.** Which sentences exist, which section they sit in, which of them
  give the ending away.
- **The agent knows you.** Which films you have seen, whether you read the source novel, how much
  you are willing to know before watching.

Neither side can decide "what counts as a spoiler *for this reader*" alone. WebMCP is what joins
them.

And one property falls out of the tool surface itself: `get_visible_section_text` returns withheld sentences
as placeholders, and `describe_withheld_content` returns their reasons and lengths but never their text.
There is no tool that hands over the ending by default. `ask_about_article` searches only the
sentences you are allowed to see, so an answer built from it cannot contain a spoiler. The agent is
not asked to keep a secret — it is never given one.

## One dial, not three settings

How much is withheld is a number from 0 to 100, on a slider. Every sentence is scored for how much
of the ending it gives away, and a sentence is withheld when its score is above 100 minus that
number. Three points on the scale are marked, because they are the ones worth a name: 0 withholds
nothing at all, 50 withholds plot summaries and the sentences that state a reveal outright, 75
withholds wording that merely hints at the ending as well.

The scoring is what makes the dial worth turning. A plot summary runs in the order the story does,
so a sentence is scored by how far into the section it sits — the opening scene is the safest thing
in it and the last sentence is the ending. Lowering the slider therefore opens a plot from its
beginning, one sentence at a time, instead of unmasking it at random. Your agent reads the same
numbers back from `describe_withheld_content`, so it can tell you how far to lower the slider for
the part you asked about without telling you what is in it.

Headings are withheld too, when the heading is the spoiler: `Series finale` comes back to the agent
as `null` with a reason, not as text. A summary of a section it cannot name cannot leak the name. The
reason never repeats the heading either, so nothing the page says about what it is hiding hands the
heading back.

Two tools do open a door, and both say so on screen. `read_withheld_section` refuses to return anything
unless the caller confirms you asked for it. `reveal_withheld_sentences` hands back the sentences you asked for by name.
Either way the sections your agent has read are listed on screen for the rest of the session.
Consent is a state you can see, not a promise in a prompt.

## Tools

| Tool | What it does |
| --- | --- |
| `open_article` | Open a Wikipedia article by title, in English or Japanese |
| `get_article_outline` | Sections, risk level, how many sentences are visible and withheld, at what sensitivity. No article text |
| `get_visible_section_text` | One section with withheld sentences replaced by placeholders |
| `describe_withheld_content` | What is withheld and why — ids, reasons, lengths, scores, never the text |
| `set_spoiler_policy` | How much this reader wants to see, as a sensitivity from 0 to 100, plus what they already know. 0 withholds nothing, 50 withholds plot summaries and outright reveals, 75 withholds hints at the ending as well |
| `mark_sections_known` | Unhide sections this reader has already lived through, with the reason shown |
| `withhold_article_content` | Withhold what the page's wording rules missed — the agent's judgement, the page's enforcement |
| `reveal_withheld_sentences` | Reveal specific sentences, when the reader asks for them |
| `reveal_section_progressively` | Open a plot only as far as the reader has watched |
| `ask_about_article` | Search for evidence answering a question, drawn only from visible sentences |
| `read_withheld_section` | Read a withheld section in full — refused unless the reader explicitly asked |
| `get_masking_report` | Audit of everything currently withheld, and which sections the agent has read |

## Running it

```sh
npm install
npm run dev
```

WebMCP is behind a flag: open `chrome://flags`, search for `mcp`, enable it and relaunch. The
reader works without an agent — the tools are an addition, not a requirement.

## Attribution

Article text comes from Wikipedia and is licensed
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); every article links back to its
source. Unspoiled is not affiliated with Wikipedia or the Wikimedia Foundation.
