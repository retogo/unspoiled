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

- **The page knows the article.** Which sentences exist, which section they sit in, and how to
  take one off your screen without leaving a gap where you can read what it said.
- **The agent knows you.** Which films you have seen, whether you read the source novel, how far
  into a series you are, how much you are willing to know before watching.

Neither side can decide "what counts as a spoiler *for this reader*" alone. WebMCP is what joins
them.

So your agent reads the article — all of it, ending included — the way a friend who has seen the
film reads it, and then decides what you get to see. `read_article_content` hands over every
sentence with an id on it, and `apply_mask` hands the decision back: show these, hide those, and
here is why. The page then enforces that decision sentence by sentence, on screen, whether or not
the agent stays around.

Reading the ending is the job, not the failure. What the page holds the agent to is narrower and
checkable: **every decision is enforced on the page and displayed to you with the reason given for
it.** The sections your agent read are listed for the rest of the session. Every call of
`apply_mask` appears under "Your agent's decisions" in the reader's own words, with the count of
what it opened and closed — a call that reached nothing included, as "0 shown · 0 hidden" — and any
sentence it opened is listed under "Revealed on your page". An agent that quietly hides half an
article has to say so on your screen, and a sentence you disagree about is one tap from coming back.

**The page works with no agent attached.** A wording heuristic scores every sentence for how much
of the ending it gives away, and one slider decides how much of that you see. That is the safety
net: the reader who never opens a chat still gets a readable article, and the agent's judgement is
an improvement on it rather than a requirement for it.

A bespoke backend and frontend could be built to do this. What WebMCP adds is that the live page
exposes semantic operations over its own local state — this sentence, that paragraph, this
section, what is on screen right now — with no server integration and no screen-coordinate
automation.

## One dial, not three settings

How much the page withholds on its own is a number from 0 to 100, on a slider. Every sentence is
scored for how much of the ending it gives away, and a sentence is withheld when its score is
above 100 minus that number. Three points on the scale are marked, because they are the ones worth
a name: 0 withholds nothing, 50 withholds plot summaries and the sentences that state a reveal
outright, 75 withholds wording that merely hints at the ending as well.

The scoring is what makes the dial worth turning. A plot summary runs in the order the story does,
so a sentence is scored by how far into the section it sits — the opening scene is the safest thing
in it and the last sentence is the ending. Lowering the slider therefore opens a plot from its
beginning, one sentence at a time, instead of unmasking it at random.

Your agent's decisions outrank the dial in both directions, and hiding outranks showing. The
slider is what the page thinks; `apply_mask` is what someone who has actually read the article and
knows you thinks. So an agent can open the first two paragraphs of a plot for a reader who stopped
watching there, and it can take down "his mother is eaten by a Titan" — a sentence with no
giveaway words in it at all, which the wording rules were never going to catch.

## Tools

| Tool | What it does |
| --- | --- |
| `open_article` | Open a Wikipedia article by title, in English or Japanese, or describe the one already open: sections, headings, sentence counts and how many are withheld right now. No article text |
| `read_article_content` | Read the article in full, spoilers included, every sentence under an id and flagged with whether the reader can currently see it |
| `apply_mask` | Show and hide sections, paragraphs or sentences, with the reason. Beats the slider in both directions; hiding beats showing. Every call is displayed on the reader's screen, and reports what it matched and which ids named nothing |
| `get_masking_report` | Audit: sensitivity, how many sentences are shown and hidden, every decision and its reason, and which sections the agent has read. No article text |

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
