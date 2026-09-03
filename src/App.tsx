import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { flowDelay, flowRuns, flowTimings, flowWords, type FlowTiming } from "./lib/flow";
import { bottomOverlap, scrollToFollow } from "./lib/scroll";
import { maskRows } from "./lib/mask";
import {
  assessSection,
  countHidden,
  headingId,
  hiddenHeading,
  hiddenSentenceReason,
  isSectionKnown,
  type Policy,
} from "./lib/risk";
import {
  segmentArticle,
  sectionHeading,
  type Article,
  type Paragraph,
  type Run,
  type Section,
  type Sentence,
} from "./lib/segment";
import {
  policyForOpened,
  readSessionStart,
  recordScanned,
  revealedOnPage,
  scannedElsewhere,
  scannedForArticle,
  sentElsewhere,
  sentToAgent,
  type ScannedSection,
  type SectionDisclosure,
} from "./lib/session";
import {
  applyTheme,
  DARK_SCHEME_QUERY,
  readTheme,
  resolveTheme,
  THEME_KEY,
  type ThemeChoice,
} from "./lib/theme";
import { buildTools, type OpenResult } from "./lib/tools";
import { registerTools, type RegistrationState, type ToolCall } from "./lib/webmcp";
import { fetchArticle, searchArticles, type Lang, type SearchHit } from "./lib/wikipedia";

const DEMO_ARTICLES: { lang: Lang; title: string; note: string }[] = [
  { lang: "en", title: "The Sixth Sense", note: "the lead paragraph already gives it away" },
  { lang: "en", title: "Fight Club (film)", note: "the twist is in the reception section" },
  { lang: "en", title: "Attack on Titan", note: "episode lists spoil four seasons at once" },
  { lang: "ja", title: "シックス・センス", note: "the Japanese edition gives it away the same way" },
];

const SENSITIVITY_KEY = "unspoiled.sensitivity";

/** A section the agent has read can still be one the reader is not allowed to see the name of. */
const WITHHELD_SECTION = "a section whose heading is withheld";

/** Three points on the scale worth a name, marked where they fall along the slider. */
const SENSITIVITY_PRESETS: { sensitivity: number; label: string; hint: string }[] = [
  { sensitivity: 0, label: "Open", hint: "Show everything, your agent's withholding included" },
  { sensitivity: 50, label: "Balanced", hint: "Withhold plot summaries and outright reveals" },
  { sensitivity: 75, label: "Strict", hint: "Withhold narrative and anything suspicious" },
];

const THEMES: { choice: ThemeChoice; label: string }[] = [
  { choice: "light", label: "Light" },
  { choice: "dark", label: "Dark" },
  { choice: "system", label: "System" },
];

function sensitivityHint(sensitivity: number): string {
  if (sensitivity === 0) return "Nothing is withheld — what your agent withheld included.";
  if (sensitivity < 25) return "Withholds how each plot summary ends.";
  if (sensitivity < 50) return "Withholds the later half of each plot summary, and outright reveals.";
  if (sensitivity < 75) return "Withholds plot summaries, and sentences that state a reveal outright.";
  return "Withholds plot summaries, analysis, and any wording that hints at the ending.";
}

/**
 * The runs of every sentence and every heading, under the id the policy knows it by, so a reveal can
 * be timed from the length of what it opened.
 */
function runsById(article: Article | null): Map<string, Run[]> {
  const runs = new Map<string, Run[]>();
  for (const section of article?.sections ?? []) {
    runs.set(headingId(section), [{ kind: "text", text: sectionHeading(section) }]);
    for (const paragraph of section.paragraphs) {
      for (const sentence of paragraph.sentences) runs.set(sentence.id, sentence.runs);
    }
  }
  return runs;
}

/** Scrolling the page from the keyboard is the reader taking it back, the same as reaching for it. */
const SCROLL_KEYS = ["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "];

/**
 * How much of the foot of the window the policy panel is sitting over. Below `lg` it is pinned
 * across the bottom of the screen; wider than that it is part of the sidebar and covers nothing.
 */
function bottomInset(): number {
  const panel = document.getElementById("sensitivity")?.closest("div");
  if (!panel) return 0;
  return bottomOverlap(panel.getBoundingClientRect(), window.innerHeight);
}

function sentenceCount(sentences: number): string {
  return sentences === 1 ? "1 sentence" : `${sentences} sentences`;
}

function sentenceTotal(rows: { sentences: number }[]): number {
  return rows.reduce((total, row) => total + row.sentences, 0);
}

export default function App() {
  const [start] = useState(() =>
    readSessionStart(window.location.search, window.localStorage.getItem(SENSITIVITY_KEY)),
  );
  const [lang, setLang] = useState<Lang>(start.article?.lang ?? "en");
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [article, setArticle] = useState<Article | null>(null);
  const [policy, setPolicy] = useState<Policy>(start.policy);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registration, setRegistration] = useState<RegistrationState>({ api: "unavailable", toolCount: 0 });
  const [calls, setCalls] = useState<ToolCall[]>([]);
  const [scanned, setScanned] = useState<ScannedSection[]>([]);
  const [flowing, setFlowing] = useState<ReadonlyMap<string, FlowTiming>>(new Map());
  const [theme, setTheme] = useState<ThemeChoice>(() => readTheme(window.localStorage.getItem(THEME_KEY)));

  const articleRef = useRef<Article | null>(null);
  const policyRef = useRef<Policy>(policy);
  const scannedRef = useRef<ScannedSection[]>(scanned);
  const openRequestRef = useRef(0);
  articleRef.current = article;
  policyRef.current = policy;
  scannedRef.current = scanned;

  const openArticle = useCallback(async (nextLang: Lang, title: string): Promise<OpenResult> => {
    const request = openRequestRef.current + 1;
    openRequestRef.current = request;
    setLang(nextLang);
    setLoading(true);
    setError(null);
    setHits([]);
    try {
      const fetched = await fetchArticle(nextLang, title);
      if (openRequestRef.current !== request) return { status: "superseded" };
      const opened = segmentArticle(fetched);
      const opening = policyForOpened(policyRef.current, articleRef.current, opened);
      setArticle(opened);
      setPolicy(opening);
      setLoading(false);
      return { status: "opened", article: opened, policy: opening };
    } catch (cause) {
      if (openRequestRef.current !== request) return { status: "superseded" };
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      setLoading(false);
      return { status: "failed", error: message };
    }
  }, []);

  const openArticleRef = useRef(openArticle);
  openArticleRef.current = openArticle;

  useEffect(() => {
    const registration = registerTools(
      buildTools({
        article: () => articleRef.current,
        policy: () => policyRef.current,
        setPolicy: (next) => {
          if (next.sensitivity !== policyRef.current.sensitivity) {
            window.localStorage.setItem(SENSITIVITY_KEY, String(next.sensitivity));
          }
          setPolicy(next);
        },
        openArticle: (toolLang, title) => openArticleRef.current(toolLang, title),
        scanned: () => scannedForArticle(scannedRef.current, articleRef.current),
        sent: () => sentToAgent(scannedRef.current, articleRef.current).flatMap((entry) => entry.ids),
        markScanned: (open, sectionId, sent) =>
          setScanned((current) => recordScanned(current, open, sectionId, sent)),
      }),
      (call) => setCalls((current) => [call, ...current].slice(0, 25)),
    );
    void registration.ready.then(setRegistration);
    return () => registration.unregister();
  }, []);

  useEffect(() => {
    if (start.article) void openArticleRef.current(start.article.lang, start.article.title);
  }, [start]);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("sensitivity", String(policy.sensitivity));
    if (article) {
      params.set("lang", article.lang);
      params.set("title", article.title);
    }
    window.history.replaceState(null, "", `?${params}`);
  }, [article, policy.sensitivity]);

  /** `system` is not a paint order, so it is resolved here and again whenever the system changes. */
  useEffect(() => {
    const system = window.matchMedia(DARK_SCHEME_QUERY);
    const paint = () => applyTheme(resolveTheme(theme, system.matches));
    paint();
    system.addEventListener("change", paint);
    return () => system.removeEventListener("change", paint);
  }, [theme]);

  const chooseTheme = useCallback((choice: ThemeChoice) => {
    window.localStorage.setItem(THEME_KEY, choice);
    setTheme(choice);
  }, []);

  const search = useCallback(async () => {
    if (term.trim().length === 0) return;
    setLoading(true);
    setError(null);
    try {
      setHits(await searchArticles(lang, term));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [lang, term]);

  const counts = useMemo(() => (article ? countHidden(article, policy) : null), [article, policy]);

  const scannedHeadings = useMemo(() => {
    if (!article) return [];
    const ids = scannedForArticle(scanned, article);
    return article.sections
      .filter((section) => ids.includes(section.id))
      .map((section) => (hiddenHeading(section, policy) ? WITHHELD_SECTION : sectionHeading(section)));
  }, [article, policy, scanned]);

  const elsewhere = useMemo(() => scannedElsewhere(scanned, article), [article, scanned]);

  const openedOnPage = useMemo(() => ledgerRows(revealedOnPage(article, policy), policy), [article, policy]);

  const sentToTheAgent = useMemo(() => ledgerRows(sentToAgent(scanned, article), policy), [article, policy, scanned]);

  const sentFromElsewhere = useMemo(() => sentElsewhere(scanned, article), [article, scanned]);

  const openedCount = sentenceTotal(openedOnPage);

  const sentCount = sentenceTotal(sentToTheAgent) + sentenceTotal(sentFromElsewhere);

  /** Only a sensitivity the reader or their agent chose is remembered; one that arrived in a link is not. */
  const chooseSensitivity = useCallback((sensitivity: number) => {
    window.localStorage.setItem(SENSITIVITY_KEY, String(sensitivity));
    setPolicy((current) => ({ ...current, sensitivity }));
  }, []);

  const reveal = (sentenceIds: string[]) =>
    setPolicy((current) => ({ ...current, revealed: new Set([...current.revealed, ...sentenceIds]) }));

  const hide = (sentenceIds: string[]) =>
    setPolicy((current) => {
      const revealed = new Set(current.revealed);
      for (const id of sentenceIds) revealed.delete(id);
      return { ...current, revealed };
    });

  /**
   * Which sentences arrive a word at a time, and when each of them begins. Opening one is a
   * deliberate act — a button here, or a reveal tool — and worth watching arrive, one sentence after
   * another, each waiting only as long as the sentence in front of it actually runs. The slider can
   * open hundreds at once and never touches `revealed`, so those keep the plain fade.
   */
  /**
   * A reveal that runs past the foot of the window carries the page down with it, so the reader
   * watches the words arrive rather than guessing where they went. The moment they scroll for
   * themselves the page is theirs again, until the next reveal asks for it.
   */
  const followRef = useRef(false);
  useEffect(() => {
    /*
     * A reveal starts a word every twenty milliseconds, so several arrive between one frame and the
     * next. Only the last of them can be the lowest on the page, so the page is measured and moved
     * once a frame rather than once a word — one reading of the layout instead of dozens.
     */
    let arriving: HTMLElement | null = null;
    const catchUp = () => {
      const word = arriving;
      arriving = null;
      if (!word || !followRef.current) return;
      const by = scrollToFollow(word.getBoundingClientRect().bottom, window.innerHeight, bottomInset());
      if (by > 0) window.scrollBy({ top: by, behavior: "smooth" });
    };
    const follow = (event: Event) => {
      if (!followRef.current) return;
      const word = event.target;
      if (!(word instanceof HTMLElement) || !word.classList.contains("unspoiled-flow")) return;
      if (!arriving) requestAnimationFrame(catchUp);
      arriving = word;
    };
    const release = () => {
      followRef.current = false;
    };
    const releaseOnKey = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.includes(event.key)) release();
    };
    document.addEventListener("animationstart", follow);
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("touchmove", release, { passive: true });
    window.addEventListener("keydown", releaseOnKey);
    return () => {
      document.removeEventListener("animationstart", follow);
      window.removeEventListener("wheel", release);
      window.removeEventListener("touchmove", release);
      window.removeEventListener("keydown", releaseOnKey);
    };
  }, []);

  /** Walking the article for every sentence is worth doing once, not once per reveal. */
  const flowSource = useMemo(() => ({ runs: runsById(article), lang: article?.lang ?? "en" }), [article]);

  const revealedBefore = useRef(policy.revealed);
  /*
   * Runs before the browser paints: the sentences a reveal opens must be drawn as flowing words
   * from their very first frame, or the whole sentence shows for an instant before the words start.
   */
  useLayoutEffect(() => {
    const before = revealedBefore.current;
    revealedBefore.current = policy.revealed;
    const opened = [...policy.revealed].filter((id) => !before.has(id));
    const closed = [...before].filter((id) => !policy.revealed.has(id));
    if (opened.length === 0 && closed.length === 0) return;
    followRef.current = opened.length > 0;
    const { runs, lang } = flowSource;
    setFlowing((current) => {
      const next = new Map(current);
      for (const id of closed) next.delete(id);
      const timings = flowTimings(opened.map((id) => flowWords(flowRuns(runs.get(id) ?? [], lang))));
      opened.forEach((id, order) => next.set(id, timings[order]));
      return next;
    });
  }, [flowSource, policy.revealed]);

  return (
    <div className="min-h-screen bg-paper pb-24 text-ink lg:pb-0">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-4">
          <h1 className="text-xl font-semibold tracking-tight">Unspoiled</h1>
          <p className="text-sm text-muted">Read Wikipedia without learning the ending.</p>
          <span
            className={`ml-auto rounded-full px-2.5 py-1 text-xs font-medium ${
              registration.api === "unavailable"
                ? "bg-raised text-muted"
                : registration.error
                  ? "bg-warn-surface text-warn-ink"
                  : "bg-ok-surface text-ok-ink"
            }`}
          >
            {registration.api === "unavailable"
              ? "No agent connected — reading on your own"
              : registration.error
                ? `This page could not expose its tools — ${registration.error}`
                : `${registration.toolCount} tools exposed via ${registration.api}`}
          </span>
          <div role="group" aria-label="Page theme" className="flex gap-0.5 rounded-full bg-raised p-0.5">
            {THEMES.map((option) => (
              <button
                key={option.choice}
                onClick={() => chooseTheme(option.choice)}
                aria-pressed={theme === option.choice}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  theme === option.choice ? "bg-ink text-inverse" : "text-muted hover:text-ink"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-6 px-5 py-6 lg:grid-cols-[1fr_18rem]">
        <aside className="space-y-5 text-sm lg:order-last lg:sticky lg:top-6 lg:self-start">
          <section>
            <h3 className="font-semibold max-lg:sr-only">Your policy</h3>
            {/*
              Below `lg` the sidebar sits above the article, which the reader then scrolls past, so
              the one control they keep reaching for is pinned to the bottom of the screen instead.
              It stays the same slider: the presets and the hint are what step aside to fit.
            */}
            <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface px-5 pt-1.5 pb-2 lg:static lg:mt-2 lg:rounded-lg lg:border-x lg:border-b lg:px-3 lg:pt-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <label htmlFor="sensitivity" className="font-medium tabular-nums">
                  Sensitivity {policy.sensitivity}
                </label>
                {counts && (
                  <span className="text-xs tabular-nums text-muted">
                    {counts.hidden} of {counts.total} sentences withheld
                  </span>
                )}
              </div>
              <input
                id="sensitivity"
                type="range"
                min={0}
                max={100}
                step={1}
                value={policy.sensitivity}
                onChange={(event) => chooseSensitivity(Number(event.target.value))}
                style={{ "--sensitivity-fill": `${policy.sensitivity}%` } as CSSProperties}
                className="sensitivity mt-2.5 w-full"
              />
              <div className="relative mt-0.5 mb-1 hidden h-8 lg:block">
                {SENSITIVITY_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => chooseSensitivity(preset.sensitivity)}
                    title={preset.hint}
                    style={{ left: `${preset.sensitivity}%` }}
                    className={`absolute top-0 flex flex-col items-center gap-1 text-[11px] ${
                      preset.sensitivity === 0 ? "" : "-translate-x-1/2"
                    } ${
                      policy.sensitivity === preset.sensitivity
                        ? "font-medium text-ink"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    <span className="h-1.5 w-px bg-edge" />
                    {preset.label}
                  </button>
                ))}
              </div>
              <p className="hidden text-xs leading-5 text-muted lg:block">{sensitivityHint(policy.sensitivity)}</p>
            </div>
            {policy.alreadyKnows.length > 0 && (
              <div className="mt-2 rounded-lg bg-warn-surface px-3 py-2 text-xs text-warn-ink">
                <p className="font-medium">Your agent says you already know</p>
                <ul className="mt-1 list-inside list-disc">
                  {policy.alreadyKnows.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <button
                  onClick={() => setPolicy((current) => ({ ...current, alreadyKnows: [] }))}
                  className="mt-1 underline"
                >
                  That is wrong — clear it
                </button>
              </div>
            )}
            {policy.notes && (
              <p className="mt-2 rounded-lg bg-warn-surface px-3 py-2 text-xs text-warn-ink">
                Your agent said: {policy.notes}
              </p>
            )}
          </section>

          {scanned.length > 0 && (
            <section>
              <h3 className="font-semibold">Your agent has read</h3>
              {scannedHeadings.length > 0 && (
                <p className="mt-1 rounded-lg bg-alert-surface px-3 py-2 text-xs text-alert-ink">
                  {scannedHeadings.join(", ")}. It knows those spoilers for the rest of this conversation.
                </p>
              )}
              {elsewhere.length > 0 && (
                <ul className="mt-1 space-y-1 text-xs text-muted">
                  {elsewhere.map((group) => (
                    <li key={group.articleTitle}>
                      {group.articleTitle} — {group.sections === 1 ? "1 section" : `${group.sections} sections`}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <Panel title="Revealed on your page" count={openedCount}>
              <Ledger
                title="Revealed on your page"
                rows={openedOnPage}
                className="border border-line bg-surface text-mask-ink"
              />
            </Panel>
            <Panel title="Text sent to your agent" count={sentCount}>
              <Ledger
                title="Text sent to your agent"
                rows={sentToTheAgent}
                elsewhere={sentFromElsewhere}
                className="border border-alert-line bg-alert-surface text-alert-ink"
              />
            </Panel>
          </div>

          <Panel title="Tool activity" count={calls.length}>
            <section>
              <h3 className="font-semibold">Tool activity</h3>
              {calls.length === 0 ? (
                <p className="mt-1 text-xs text-muted">Nothing yet. Ask your agent to filter this page.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-xs">
                  {calls.map((call) => (
                    <li key={`${call.at}-${call.tool}`} className="rounded bg-surface px-2 py-1">
                      <code className="font-medium">{call.tool}</code>
                      {!call.ok && <span className="ml-1 font-medium text-alert-text">error</span>}
                      <span className={`block ${call.ok ? "text-muted" : "text-alert-text"}`}>
                        {call.input} → {call.summary}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </Panel>
        </aside>

        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <select
              value={lang}
              onChange={(event) => setLang(event.target.value as Lang)}
              className="rounded-lg border border-edge bg-surface px-2 py-2 text-sm"
            >
              <option value="en">English</option>
              <option value="ja">日本語</option>
            </select>
            <input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) void search();
              }}
              placeholder="Search Wikipedia for a film, series or novel"
              className="min-w-0 flex-1 basis-full rounded-lg border border-edge bg-surface px-3 py-2 text-sm sm:basis-auto"
            />
            <button
              onClick={() => void search()}
              className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-inverse"
            >
              Search
            </button>
          </div>

          {!article && (
            <div className="mt-4 flex flex-wrap gap-2">
              {DEMO_ARTICLES.map((demo) => (
                <button
                  key={`${demo.lang}:${demo.title}`}
                  onClick={() => void openArticle(demo.lang, demo.title)}
                  className="rounded-lg border border-edge bg-surface px-3 py-2 text-left text-sm hover:border-edge-hover"
                >
                  <span className="font-medium">{demo.title}</span>
                  <span className="block text-xs text-muted">{demo.note}</span>
                </button>
              ))}
            </div>
          )}

          {loading && <p className="mt-6 text-sm text-muted">Loading…</p>}
          {error && <p className="mt-6 text-sm text-alert-text">{error}</p>}

          {hits.length > 0 && (
            <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-surface">
              {hits.map((hit) => (
                <li key={hit.title}>
                  <button
                    onClick={() => void openArticle(lang, hit.title)}
                    className="block w-full px-4 py-3 text-left hover:bg-row-hover"
                  >
                    <span className="text-sm font-medium">{hit.title}</span>
                    <span className="block text-xs text-muted">{hit.snippet}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {article && (
            <article className="mt-6">
              <h2 className="text-2xl font-semibold tracking-tight">{article.displayTitle}</h2>
              <p className="mt-1 text-xs text-muted">
                {counts?.hidden} of {counts?.total} sentences withheld ·{" "}
                <a className="underline" href={article.sourceUrl} target="_blank" rel="noreferrer">
                  original article
                </a>
              </p>
              {article.sections.map((section) => (
                <SectionView
                  key={section.id}
                  section={section}
                  policy={policy}
                  lang={article.lang}
                  flowing={flowing}
                  onReveal={reveal}
                  onHide={hide}
                  onOpen={(title) => void openArticle(article.lang, title)}
                />
              ))}
              {article.references.length > 0 && (
                <section className="mt-8">
                  <h3 className="border-b border-line pb-1 text-lg font-semibold">References</h3>
                  <ol className="mt-3 list-decimal space-y-1.5 pl-6 text-xs text-muted marker:text-faint">
                    {article.references.map((reference) => (
                      <li key={reference.id} id={reference.id} className="scroll-mt-20">
                        <RunsText
                          runs={reference.runs}
                          lang={article.lang}
                          onOpen={(title) => void openArticle(article.lang, title)}
                        />
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </article>
          )}
        </div>
      </main>

      <footer className="mx-auto max-w-5xl px-5 py-8 text-xs text-muted">
        Article text from Wikipedia, licensed{" "}
        <a className="underline" href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">
          CC BY-SA 4.0
        </a>
        . Unspoiled is not affiliated with Wikipedia or the Wikimedia Foundation.
      </footer>
    </div>
  );
}

type LedgerRow = { sectionId: string; label: string; sentences: number };

function ledgerRows(disclosures: SectionDisclosure[], policy: Policy): LedgerRow[] {
  return disclosures.map(({ section, ids }) => ({
    sectionId: section.id,
    label: hiddenHeading(section, policy) ? WITHHELD_SECTION : sectionHeading(section),
    sentences: ids.length,
  }));
}

/**
 * Below `lg` the sidebar sits above the article, so each panel folds away and its summary carries
 * the count: a folded panel still says how much it holds. From `lg` up the summary steps aside and
 * the fold is held open in CSS, leaving a plain section in the right column.
 */
function Panel({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <details className="panel">
      <summary className="cursor-pointer rounded-lg border border-line bg-surface px-3 py-2 font-semibold">
        {title} · {count}
      </summary>
      {children}
    </details>
  );
}

/**
 * The pair of ledgers is the claim the reader can check: what this page opened on their screen,
 * and what of the withheld text left it. Both stay on screen empty, so the absence of a disclosure
 * is as visible as a disclosure.
 */
function Ledger({
  title,
  rows,
  elsewhere = [],
  className,
}: {
  title: string;
  rows: LedgerRow[];
  elsewhere?: { articleTitle: string; sentences: number }[];
  className: string;
}) {
  return (
    <section>
      <h3 className="font-semibold">{title}</h3>
      {rows.length === 0 && elsewhere.length === 0 && <p className="mt-1 text-xs text-muted">Nothing yet.</p>}
      {rows.length > 0 && (
        <ul className={`mt-1 space-y-0.5 rounded-lg px-3 py-2 text-xs ${className}`}>
          {rows.map((row) => (
            <li key={row.sectionId}>
              {row.label} — {sentenceCount(row.sentences)}
            </li>
          ))}
        </ul>
      )}
      {elsewhere.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-muted">
          {elsewhere.map((group) => (
            <li key={group.articleTitle}>
              {group.articleTitle} — {sentenceCount(group.sentences)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A withheld paragraph stands as tall as the lines it replaces, at the leading of the body text. */
const MASK_ROW_REM = 1.75;

function SectionView({
  section,
  policy,
  lang,
  flowing,
  onReveal,
  onHide,
  onOpen,
}: {
  section: Section;
  policy: Policy;
  lang: Lang;
  flowing: ReadonlyMap<string, FlowTiming>;
  onReveal: (sentenceIds: string[]) => void;
  onHide: (sentenceIds: string[]) => void;
  onOpen: (title: string) => void;
}) {
  const risk = assessSection(section);
  const known = isSectionKnown(policy, section.id);
  const groups = section.paragraphs.map((paragraph) => groupSentences(paragraph, section, policy));
  const hidden = groups.reduce(
    (total, group) => total + group.reduce((count, run) => count + (run.hidden ? run.sentences.length : 0), 0),
    0,
  );
  const withheld = groups.filter((group) => group.every((run) => run.hidden)).length;
  const opened = section.paragraphs.flatMap((paragraph) =>
    paragraph.sentences.filter((sentence) => policy.revealed.has(sentence.id)).map((sentence) => sentence.id),
  );
  const heading = (
    <SectionHeading
      section={section}
      hidden={hidden}
      known={known}
      policy={policy}
      lang={lang}
      flowing={flowing}
      opened={opened}
      onReveal={onReveal}
      onHide={onHide}
      onOpen={onOpen}
    />
  );

  return (
    <section className="mt-6">
      {heading}
      {withheld > 0 && (
        <p className="unspoiled-mask mt-2 text-xs text-muted">
          {withheld} of {section.paragraphs.length} paragraphs withheld — {risk.reason}. Plot summaries run in
          order, so you can open only as far as you have watched.
        </p>
      )}
      {/*
        * A paragraph keeps its own shape whatever the rest of the section is doing: withheld whole, it
        * is a band; opened, it is prose. Both sit in the same list under the same margin, so opening
        * one moves nothing but itself.
        */}
      {section.paragraphs.map((paragraph, index) =>
        groups[index].every((run) => run.hidden) ? (
          <WithheldParagraph key={paragraph.id} paragraph={paragraph} lang={lang} onReveal={onReveal} />
        ) : (
          <p key={paragraph.id} className="mt-3 leading-7">
            {/*
              * One flat list keyed by sentence rather than by run, so hiding a sentence leaves the ones
              * around it mounted where they are instead of arriving all over again.
              */}
            {groups[index].flatMap((run) =>
              run.hidden
                ? [
                    <button
                      key={run.key}
                      onClick={() => onReveal(run.sentences.map((sentence) => sentence.id))}
                      title={run.reason}
                      className="unspoiled-mask mx-0.5 rounded bg-mask px-2 py-0.5 align-baseline text-xs text-mask-ink hover:bg-mask-hover"
                    >
                      {sentenceCount(run.sentences.length)} withheld · reveal
                    </button>,
                  ]
                : run.sentences.map((sentence) => (
                    <SentenceView
                      key={sentence.id}
                      sentence={sentence}
                      lang={lang}
                      timing={flowing.get(sentence.id)}
                      onHide={policy.revealed.has(sentence.id) ? onHide : null}
                      onOpen={onOpen}
                    />
                  )),
            )}
          </p>
        ),
      )}
    </section>
  );
}

/** A paragraph withheld whole: a band of fill standing where its lines would be. */
function WithheldParagraph({
  paragraph,
  lang,
  onReveal,
}: {
  paragraph: Paragraph;
  lang: Lang;
  onReveal: (sentenceIds: string[]) => void;
}) {
  const chars = paragraph.sentences.reduce((total, sentence) => total + sentence.text.length, 0);
  const held = `${sentenceCount(paragraph.sentences.length)} withheld`;
  return (
    <button
      onClick={() => onReveal(paragraph.sentences.map((sentence) => sentence.id))}
      aria-label={`Reveal ${held}, ${chars} chars`}
      style={{ minHeight: `${maskRows(chars, lang) * MASK_ROW_REM}rem` }}
      className="unspoiled-mask mt-3 flex w-full items-start rounded bg-mask px-2 py-1 text-left text-xs text-mask-ink hover:bg-mask-hover"
    >
      {held} · {chars} chars · reveal
    </button>
  );
}

/**
 * The marker that says a run of text is on screen because the reader opened it. Closing it again is
 * something the reader wants done at once, so the text itself is the control rather than a target
 * they have to aim at, and the underline is all the invitation it needs.
 */
const OPENED =
  "cursor-pointer underline decoration-dotted decoration-edge underline-offset-4 hover:decoration-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/** A click that lands on a link, or that ends a drag over the text, is not a request to close it. */
function closesOnClick(target: EventTarget | null): boolean {
  if (target instanceof Element && target.closest("a")) return false;
  return (window.getSelection()?.toString() ?? "") === "";
}

/** Solid and tight against the words, so it reads apart from the dotted marker of an opened run. */
const INLINE_LINK = "underline decoration-edge underline-offset-2 hover:decoration-ink";

/**
 * A sentence the reader can see. One the slider opened fades in whole; one they opened themselves
 * arrives word by word and closes again on a tap. That control is named for the sentence rather
 * than for what it does, so a reader listening to the page still hears the prose it took a
 * deliberate act to open — spelled out, because the words are separate elements while they arrive
 * and a name read from those runs them together. What the control does is the description instead.
 */
function SentenceView({
  sentence,
  lang,
  timing,
  onHide,
  onOpen,
  label = "Hide this sentence again",
}: {
  sentence: Sentence;
  lang: Lang;
  timing: FlowTiming | undefined;
  onHide: ((sentenceIds: string[]) => void) | null;
  onOpen: (title: string) => void;
  label?: string;
}) {
  const body =
    timing === undefined ? (
      <span className="unspoiled-text">
        <RunsText runs={sentence.runs} lang={lang} onOpen={onOpen} />
      </span>
    ) : (
      <FlowingText runs={sentence.runs} lang={lang} timing={timing} onOpen={onOpen} />
    );

  if (!onHide) {
    return (
      <>
        {body}{" "}
      </>
    );
  }

  const close = () => onHide([sentence.id]);
  return (
    <>
      <span
        role="button"
        tabIndex={0}
        aria-label={sentence.text}
        title={label}
        onClick={(event) => {
          if (closesOnClick(event.target)) close();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          close();
        }}
        className={OPENED}
      >
        {body}
      </span>{" "}
    </>
  );
}

/**
 * A link stays a link once the text is on screen. An internal one opens the article here rather
 * than on Wikipedia, where the reader would meet the ending unguarded; it is still written as an
 * address so a middle click or a copied link shares the same reading. Nothing names the page a link
 * leads to beyond the words already in the sentence: a link on "the boy" pointing at "Ghost" would
 * give the film away before the reader followed it.
 */
function RunLink({
  run,
  lang,
  onOpen,
  children,
}: {
  run: Run;
  lang: Lang;
  onOpen: (title: string) => void;
  children: ReactNode;
}) {
  if (run.kind === "wiki") {
    return (
      <a
        href={`?${new URLSearchParams({ lang, title: run.title })}`}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault();
          onOpen(run.title);
        }}
        className={INLINE_LINK}
      >
        {children}
      </a>
    );
  }
  if (run.kind === "external") {
    return (
      <a href={run.href} target="_blank" rel="noopener noreferrer" className={INLINE_LINK}>
        {children}
        <span aria-hidden="true" className="ml-0.5 align-super text-[0.65em] text-muted">
          &#8599;
        </span>
      </a>
    );
  }
  if (run.kind === "note") {
    return (
      <sup className="mx-px">
        <a href={`#${run.noteId}`} className="text-[0.85em] text-muted hover:text-ink">
          {children}
        </a>
      </sup>
    );
  }
  return <>{children}</>;
}

/** Text that is already on screen, with its links and citation markers where the article put them. */
function RunsText({
  runs,
  lang,
  onOpen,
}: {
  runs: Run[];
  lang: Lang;
  onOpen: (title: string) => void;
}) {
  return (
    <>
      {runs.map((run, index) => (
        <RunLink key={index} run={run} lang={lang} onOpen={onOpen}>
          {run.text}
        </RunLink>
      ))}
    </>
  );
}

/**
 * The words of an opened sentence, each set to arrive a beat after the one before it. Splitting into
 * words happens inside a run so a link is never cut in half, and the beats keep counting across the
 * runs, and on from where the sentence before it left off.
 */
function FlowingText({
  runs,
  lang,
  timing,
  onOpen,
}: {
  runs: Run[];
  lang: Lang;
  timing: FlowTiming;
  onOpen: (title: string) => void;
}) {
  const timed = useMemo(() => {
    let index = 0;
    return flowRuns(runs, lang).map((pieces) =>
      pieces.map((piece) => ({ piece, delay: flowDelay(index++, timing) })),
    );
  }, [lang, runs, timing]);

  return (
    <>
      {runs.map((run, at) => (
        <RunLink key={at} run={run} lang={lang} onOpen={onOpen}>
          {timed[at].map(({ piece, delay }, index) => (
            <span
              key={`${index}:${piece}`}
              className="unspoiled-flow"
              style={{ animationDelay: `${delay}ms` }}
            >
              {piece}
            </span>
          ))}
        </RunLink>
      ))}
    </>
  );
}

function SectionHeading({
  section,
  hidden,
  known,
  policy,
  lang,
  flowing,
  opened,
  onReveal,
  onHide,
  onOpen,
}: {
  section: Section;
  hidden: number;
  known: string | null;
  policy: Policy;
  lang: Lang;
  flowing: ReadonlyMap<string, FlowTiming>;
  opened: string[];
  onReveal: (ids: string[]) => void;
  onHide: (ids: string[]) => void;
  onOpen: (title: string) => void;
}) {
  const withheldHeading = hiddenHeading(section, policy);
  const id = headingId(section);
  const text = sectionHeading(section);
  const heading = policy.revealed.has(id) ? (
    <SentenceView
      sentence={{ id, text, runs: [{ kind: "text", text }] }}
      lang={lang}
      timing={flowing.get(id)}
      onHide={onHide}
      onOpen={onOpen}
      label="Hide this heading again"
    />
  ) : (
    sectionHeading(section)
  );

  return (
    <h3 className="flex flex-wrap items-baseline gap-2 border-b border-line pb-1 text-lg font-semibold">
      {withheldHeading ? (
        <button
          onClick={() => onReveal([id])}
          title={withheldHeading.reason}
          className="unspoiled-mask rounded bg-mask px-2 py-0.5 text-sm font-medium text-mask-ink hover:bg-mask-hover"
        >
          Heading withheld · reveal
        </button>
      ) : (
        heading
      )}
      {known ? (
        <span className="rounded bg-warn-badge px-1.5 py-0.5 text-[11px] font-medium text-warn-ink">
          shown — {known}
        </span>
      ) : (
        hidden > 0 && (
          <span className="rounded bg-raised px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-mask-ink">
            {hidden} withheld
          </span>
        )
      )}
      {opened.length > 1 && (
        <button
          onClick={() => onHide(opened)}
          className="rounded bg-mask px-1.5 py-0.5 text-[11px] font-medium text-mask-ink hover:bg-mask-hover"
        >
          Hide {opened.length} sentences again
        </button>
      )}
    </h3>
  );
}

type SentenceRun = {
  key: string;
  hidden: boolean;
  reason?: string;
  sentences: Sentence[];
};

function groupSentences(paragraph: Paragraph, section: Section, policy: Policy): SentenceRun[] {
  const runs: SentenceRun[] = [];
  for (const sentence of paragraph.sentences) {
    const withheld = hiddenSentenceReason(sentence, section, policy);
    const hidden = withheld !== null;
    const last = runs[runs.length - 1];
    if (last && last.hidden === hidden) {
      last.sentences.push(sentence);
      last.key = `${last.sentences[0].id}.${last.sentences.length}`;
      continue;
    }
    runs.push({ key: `${sentence.id}.1`, hidden, reason: withheld?.reason, sentences: [sentence] });
  }
  return runs;
}
