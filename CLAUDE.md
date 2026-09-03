# Unspoiled

A Wikipedia reader that withholds spoilers in the page and exposes that filtering to the
reader's AI agent as WebMCP tools. Built for the WebMCP Challenge (Devpost); judged on
non-trivial WebMCP use and finished execution. Static site, no backend, MIT (keep `LICENSE`
at the root). The reader must work with no agent attached; the tools are an addition.

## Commands

- `npm test` runs vitest once; `npm run test:watch` while developing.
- `npm run build` is `tsc -b && vite build`: type errors fail the build, so run it before committing.
- `npm run lint` (oxlint) is clean; keep it that way.
- The React Compiler is on (`react({ compiler: true })`, which needs `oxc-transform-react`), so write
  components plainly and leave `memo` / `useMemo` / `useCallback` out unless a measurement asks for
  one. It currently compiles every component in `App.tsx`; it silently skips a component that reads
  refs during render or uses `try`/`finally`, so check after such changes by transforming the file
  with `transformSync(file, source, { reactCompiler: true, lang: "tsx" })` and reading `errors`.
- Deploy: `vercel deploy --prod --yes --scope retogo`. Without `--scope` the CLI says "Not authorized".

## Invariants (the product claim; break one and the project is pointless)

- The agent reads the whole article, spoilers included, and decides what the reader sees. That is
  the task, not a leak. `read_article_content` returns every sentence of what it is asked for.
- Precedence when deciding whether a sentence shows: `hidden` beats `shown`, and both beat the
  page's wording rules. A decision therefore holds at every sensitivity, including zero.
- `apply_mask` applies one decision in one call: sections, paragraphs and sentences on either
  side, `hide` winning where a sentence is named on both. A blank `reason` is the only thing that
  fails the call — the page has nothing to show the reader without it. An id that names nothing
  comes back in `unknown_ids` beside `matched`, and does not lose the rest of the call.
- Every call of `apply_mask` is recorded and shown, including one that matched nothing or changed
  nothing: it appears as "0 shown · 0 hidden" with its reason. A silent no-op is a decision the
  reader cannot disagree with.
- "Agent activity" is the one complete record: every call, in the order it was made, with its
  counts and the whole of its reason, for the length of the session. The notice that carries a
  decision past the reader is a summary of one call and nothing is kept only there. A decision made
  on another article keeps its place in that list and is named with the article it was made on;
  `get_masking_report` reports only the decisions of the article open, whose ids still mean something.
- Every decision reaches the screen, and where it goes is set by what the reader cannot afford to
  miss. The sections `read_article_content` touched are named in front of the article, under
  "Your agent has read:", for as long as that article is open, and there is nothing to dismiss them
  with: reading cannot be undone. Each `apply_mask` says itself once as it lands, counts and reason,
  in a notice that waits while the reader has it under the pointer and then goes; the standing
  record of every decision and every tool call is folded away under the article in "Agent
  activity". Never filter silently, and do not rename the warning or the drawer.
- The reader outranks everyone: a tap lands in the same two sets, so it can take back what the
  agent decided. Only `apply_mask` writes to `decisions`.
- Withheld text is never in the DOM. Render placeholders; never blur or hide real text with CSS.
- Sentence, paragraph and section ids (`s3`, `p12`, `p12.4`) are positional and valid only for the
  article currently open. Reset article-scoped policy on article change; never trust ids from a URL.
  Sensitivity belongs to the reader and survives the change, and so does the log in `decisions`:
  those ids are never applied again, and the reader keeps the record of what was decided for them.
- Sensitivity and literal excluded words are the reader's controls, and the safety net for a reader with no agent attached.
  No tool sets it; `get_masking_report` reports it. It is the only thing the sidebar holds:
  everything the page has to say about the agent is placed against the article instead.
- Tool names say what they hand the agent (`read_article_content`, `apply_mask`). Never name
  anything "safe": the wording rules miss spoilers, and shown does not mean spoiler-free. Excluded
  words are stored on the reader's device and survive article changes.
- Rules added through `add_rules` may themselves reveal a spoiler. They are literal, case-insensitive
  matches and stay redacted in the UI until the reader explicitly reveals one; the tool result,
  activity log and masking report expose only their count. Disclosure state is not persisted.
- Tool descriptions are the only channel the page has to steer an agent. Each one names the call
  that should come next, and `read_article_content` is where the agent is told not to repeat what
  it read. Treat them as product copy and update them with every behaviour change.
- Masking protects against accidental exposure through the agent, not against a reader who opens
  view-source. Do not describe it as a security boundary.

## WebMCP as shipped in Chrome (measured, not read from drafts)

- The API is `document.modelContext`. `navigator.modelContext` does not exist; `webmcp.ts`
  probes both, keep that order.
- Tool arguments arrive as a JSON string and whatever `execute` returns is JSON-stringified.
  Return `{ content: [{ type: "text", text }] }` and `isError: true` on failure. Image or other
  content types never reach the model.
- There is no `unregisterTool`, and registering a name the page already holds rejects with
  `InvalidStateError: Duplicate tool name`. `registerTools` is therefore idempotent: it hands a
  name to the browser at most once and treats a duplicate as already exposed. The handler the
  browser keeps looks its definition up on every call, so React's double mount in development
  does not leave a stale one behind.
- A page cannot detect an attached agent or call one. Every flow starts with the human.
- Testing: `chrome://flags` → search `mcp` → enable → relaunch. DevTools has an Application →
  WebMCP panel. ChatGPT's in-app browser also supports it.

## Wikipedia

- Fetch from the MediaWiki `action=parse` API with `origin=*` and `prop=text` (parsed HTML;
  wikitext is template noise). Do not add request headers: that triggers a CORS preflight the API
  does not answer. Redirects are already followed (`redirects=1`).
- Sections come from the h2–h4 headings in the HTML, not from the API. `headingPath` carries the
  ancestor headings so "Season 1" under "Plot" is still narrative.
- Body text includes `li`, `dd`/`dt` and table rows (episode tables are where TV spoilers live).
- Keep the CC BY-SA attribution, the link to each source article, and the "not affiliated with
  Wikipedia or the Wikimedia Foundation" line. Never bundle article text into the repo.
- Scripts hitting the API from a shell need a real `User-Agent` (curl is fine, urllib gets 403).

## Testing

- Add a failing test before the fix or feature. Pure logic lives in `src/lib/*.ts` and is tested
  directly; App behaviour is tested by rendering `<App />` with `document.modelContext` stubbed
  and calling the registered tools (see `installAgent` in `src/App.session.test.tsx`).
- When `Section` or `Policy` gain fields, each test file has one factory near the top to update.

## Style and etiquette

- Everything in the repo is English: identifiers, comments, UI strings, README, commit messages.
  Japanese appears only as data: the heading and reveal-word rules in `risk.ts`, and test fixtures.
- No comments about history ("previously", "fixed for review"); that belongs in git.
- Commit messages are one imperative sentence stating the intent, as in `git log`.
