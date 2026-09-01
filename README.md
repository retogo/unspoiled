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

And one property falls out of the tool surface itself: `get_safe_text` returns withheld sentences
as placeholders, and `describe_hidden` returns their reasons and lengths but never their text.
There is no tool that returns the ending. The agent is not asked to keep a secret — it is never
given one.

## Tools

| Tool | What it does |
| --- | --- |
| `open_article` | Open a Wikipedia article by title, in English or Japanese |
| `get_article_outline` | Sections, risk level, how many sentences are visible and withheld. No article text |
| `get_safe_text` | One section with withheld sentences replaced by placeholders |
| `describe_hidden` | What is withheld and why — ids, reasons, lengths, never the text |
| `set_spoiler_policy` | How much this reader wants to see, plus what they already know |
| `reveal` | Reveal specific sentences, when the reader asks for them |
| `get_masking_report` | Audit of everything currently withheld |

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
