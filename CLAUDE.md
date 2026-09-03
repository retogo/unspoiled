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

- No tool returns withheld sentence text or a withheld heading by default. The only doors are
  `read_withheld_section` (refuses without `acknowledge: true`) and `reveal_withheld_sentences`.
  Both must record the sections opened so they appear under "Your agent has read".
- Nothing returned to the agent may repeat a withheld heading: not `heading`, not a `reason`,
  not a search `evidence` row. Reasons are fixed phrases, never templates with the heading in them.
- Withheld text is never in the DOM. Render placeholders; never blur or hide real text with CSS.
- Everything the agent asserts about the reader (`already_knows`, `because`, notes) is shown on
  screen with a way to correct it. Never profile the reader silently.
- Precedence when deciding whether a sentence shows: the reader's explicit choice (revealed,
  known section, or the most open policy) beats the agent's `withhold_article_content`, which
  beats the page's wording heuristics. Headings follow the same order as sentences.
- Sentence and section ids (`s3`, `p12.4`, `s3.heading`) are positional and valid only for the
  article currently open. Reset article-scoped policy on article change; never trust ids from a URL.
- Tool names say what they hand the agent (`get_visible_section_text`, `read_withheld_section`).
  Never name anything "safe": the wording rules miss spoilers, and visible does not mean spoiler-free.
- Tool descriptions are the only channel the page has to steer an agent. Each one names the call
  that should come next. Treat them as product copy and update them with every behaviour change.
- Withholding protects against accidental exposure through the agent, not against a reader who
  opens view-source. Do not describe it as a security boundary.

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
