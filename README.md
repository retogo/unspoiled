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
it.** The sections your agent has read are named in front of the article for as long as it is open,
because knowing the ending is not something it can undo. Every call of `apply_mask` says itself as
it lands — what it showed, what it hid, and why, in the reader's own words — and is kept under
"Agent activity" beneath the article, a call that reached nothing included, as "0 shown · 0 hidden".
An agent that quietly hides half an article has to say so on your screen, and a sentence you
disagree about is one tap from coming back.

**The page works with no agent attached.** A wording heuristic scores every sentence for how much
of the ending it gives away, and one slider decides how much of that you see. That is the safety
net: the reader who never opens a chat still gets a readable article, and the agent's judgement is
an improvement on it rather than a requirement for it.

A bespoke backend and frontend could be built to do this. What WebMCP adds is that the live page
exposes semantic operations over its own local state — this sentence, that paragraph, this
section, what is on screen right now — with no server integration and no screen-coordinate
automation.

## One dial, and what it is a dial over

How much the page withholds on its own is a number from 0 to 100, on a slider. Every sentence is
scored for how much of the ending it gives away, and a sentence is withheld when its score is above
100 minus that number. Five points on the scale are marked, and each one is named for what it takes
off the screen rather than for how strict it is:

| | Preset | What it hides |
| --- | --- | --- |
| 0 | Show everything | Nothing on the page's own account. Your agent's decisions and your rules still apply |
| 20 | Ending only | The final scene, who dies, who did it |
| 45 | Major spoilers | Endings, deaths, identities, winners and major reveals |
| 65 | Spoiler-safe | Whole plot summaries, analysis, and wording that hints at the ending. The default |
| 100 | Maximum protection | Anything the page finds even slightly suspicious |

What the names divide is a score, and the score comes from two things. A sentence's wording is
matched against seven kinds of spoiler — death, identity, outcome, return, relationship, ending and
hint — and each kind carries its own weight, so being told who dies costs more than a sentence that
merely leans towards the ending. Naming the kinds is what lets one number mean something: the
reader is not choosing a strictness, they are choosing how far down that list they want to be
protected.

The other half is position. A plot summary runs in the order the story does, so a sentence is also
scored by how far into the section it sits — the opening scene is the safest thing in it and the
last sentence is the ending. A sentence is worth whichever of the two gives more away. Lowering the
slider therefore opens a plot from its beginning, one sentence at a time, instead of unmasking it
at random, while a death in a production section is still withheld.

Your agent's decisions outrank the dial in both directions, and hiding outranks showing. The
slider is what the page thinks; `apply_mask` is what someone who has actually read the article and
knows you thinks. So an agent can open the first two paragraphs of a plot for a reader who stopped
watching there, and it can take down "his mother is eaten by a Titan" — a sentence with no
giveaway words in it at all, which the wording rules were never going to catch.

## Always hide

Under the slider is the reader's other control: phrases the page withholds wherever they appear, at
every sensitivity, including the one that withholds nothing else. A rule is a phrase rather than a
sentence id, so there is nothing to tie it to one page — it applies to every article the reader
opens, and is kept on their device until they take it down.

An agent adds one with `add_rules`, and this is the one thing it hands the page that the page then
shows the reader in the agent's own words. So the reader sees the rule's label, its reason and how
many sentences of the article in front of them it reached — all of it, without opening anything. The phrases are the exception: the phrase an agent picks to catch a spoiler is
very often the spoiler, so they stand behind the same mask a withheld sentence does, under
`Show phrases`. A label that repeats one of its own phrases fails the call, because it would print
the spoiler above the mask.

## Tools

| Tool | What it does |
| --- | --- |
| `open_article` | Open a Wikipedia article by title, in English or Japanese, or describe the one already open: sections, headings, sentence counts and how many are withheld right now. No article text |
| `read_article_content` | Read the article in full, spoilers included, every sentence under an id and flagged with whether the reader can currently see it |
| `apply_mask` | Show and hide sections, paragraphs or sentences, with the reason. Beats the slider in both directions; hiding beats showing. Every call is displayed on the reader's screen, and reports what it matched and which ids named nothing |
| `add_rules` | Add standing rules that withhold every sentence carrying one of their phrases, in every article and in later sessions. The reader sees the label, reason and match count; the phrases stay behind `Show phrases`, and a label that repeats one of them fails the call |
| `get_masking_report` | Audit: sensitivity, how many sentences are shown and hidden, every standing rule by its label and how far it reaches, every decision and its reason, and which sections the agent has read. No article text and no rule phrases |

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
