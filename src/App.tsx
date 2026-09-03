import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { flowDelay, flowRuns, flowTimings, flowWords, type FlowTiming } from "./lib/flow";
import { bottomOverlap, scrollToFollow } from "./lib/scroll";
import { maskRows } from "./lib/mask";
import {
  assessSection,
  countHidden,
  hiddenSentenceReason,
  maskWith,
  type Decision,
  type Policy,
} from "./lib/risk";
import {
  segmentArticle,
  isLead,
  sectionHeading,
  type Article,
  type Paragraph,
  type Run,
  type Section,
  type Sentence,
} from "./lib/segment";
import {
  historyActionFor,
  policyForOpened,
  readArticleTarget,
  readSessionStart,
  recordScanned,
  revealedOnPage,
  scannedElsewhere,
  scannedForArticle,
  type ScannedSection,
  type SectionDisclosure,
  type SharedArticle,
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
import { fetchArticle, type Lang } from "./lib/wikipedia";
import { useSuggestions } from "./useSuggestions";

const DEMO_ARTICLES: { lang: Lang; title: string; note: string }[] = [
  { lang: "en", title: "The Sixth Sense", note: "the lead paragraph already gives it away" },
  { lang: "en", title: "Fight Club (film)", note: "the twist is in the reception section" },
  { lang: "en", title: "Attack on Titan", note: "episode lists spoil four seasons at once" },
  { lang: "ja", title: "シックス・センス", note: "the Japanese edition gives it away the same way" },
];

const SENSITIVITY_KEY = "unspoiled.sensitivity";

/** Three points on the scale worth a name, marked where they fall along the slider. */
const SENSITIVITY_PRESETS: { sensitivity: number; label: string; hint: string }[] = [
  { sensitivity: 0, label: "Open", hint: "Withhold nothing the page has not been told to withhold" },
  { sensitivity: 50, label: "Balanced", hint: "Withhold plot summaries and outright reveals" },
  { sensitivity: 75, label: "Strict", hint: "Withhold narrative and anything suspicious" },
];

/** Which Wikipedia to search. The pair sits inside the field: a search is a term and an edition. */
const LANGUAGES: { lang: Lang; label: string; title: string }[] = [
  { lang: "en", label: "EN", title: "Search the English Wikipedia" },
  { lang: "ja", label: "JA", title: "Search the Japanese Wikipedia" },
];

const THEMES: { choice: ThemeChoice; label: string }[] = [
  { choice: "light", label: "Light" },
  { choice: "dark", label: "Dark" },
  { choice: "system", label: "System" },
];

function sensitivityHint(sensitivity: number): string {
  if (sensitivity === 0) return "The page withholds nothing. Your agent's decisions still stand.";
  if (sensitivity < 25) return "Withholds how each plot summary ends.";
  if (sensitivity < 50) return "Withholds the later half of each plot summary, and outright reveals.";
  if (sensitivity < 75) return "Withholds plot summaries, and sentences that state a reveal outright.";
  return "Withholds plot summaries, analysis, and any wording that hints at the ending.";
}

/**
 * The runs of every sentence, under the id the policy knows it by, so a reveal can be timed from
 * the length of what it opened.
 */
function runsById(article: Article | null): Map<string, Run[]> {
  const runs = new Map<string, Run[]>();
  for (const section of article?.sections ?? []) {
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
  const [article, setArticle] = useState<Article | null>(null);
  const [policy, setPolicy] = useState<Policy>(start.policy);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registration, setRegistration] = useState<RegistrationState>({ api: "unavailable", toolCount: 0 });
  const [calls, setCalls] = useState<ToolCall[]>([]);
  const [scanned, setScanned] = useState<ScannedSection[]>([]);
  const [flowing, setFlowing] = useState<ReadonlyMap<string, FlowTiming>>(new Map());
  const [theme, setTheme] = useState<ThemeChoice>(() => readTheme(window.localStorage.getItem(THEME_KEY)));

  /*
   * The tools are handed to the browser once, on mount, and are called long afterwards, so they read
   * the page through refs rather than through the render that registered them. The refs are caught
   * up after each commit: a render that wrote to them would be a render with a side effect, which is
   * both a lie about the render and enough to stop the compiler optimising anything here.
   */
  const articleRef = useRef<Article | null>(null);
  const policyRef = useRef<Policy>(policy);
  const scannedRef = useRef<ScannedSection[]>(scanned);
  const openRequestRef = useRef(0);
  const writtenRef = useRef<SharedArticle | null | undefined>(undefined);
  useLayoutEffect(() => {
    articleRef.current = article;
    policyRef.current = policy;
    scannedRef.current = scanned;
  });

  const openArticle = useCallback(async (nextLang: Lang, title: string): Promise<OpenResult> => {
    const request = openRequestRef.current + 1;
    openRequestRef.current = request;
    setLang(nextLang);
    setLoading(true);
    setError(null);
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

  /** Going back to an entry that names no article leaves the reader on the search screen. */
  const closeArticle = useCallback(() => {
    openRequestRef.current += 1;
    setArticle(null);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    const registration = registerTools(
      buildTools({
        article: () => articleRef.current,
        policy: () => policyRef.current,
        setPolicy,
        openArticle: (toolLang, title) => openArticle(toolLang, title),
        scanned: () => scannedForArticle(scannedRef.current, articleRef.current),
        markScanned: (open, sectionIds) =>
          setScanned((current) =>
            sectionIds.reduce((all, sectionId) => recordScanned(all, open, sectionId), current),
          ),
      }),
      (call) => setCalls((current) => [call, ...current].slice(0, 25)),
    );
    void registration.ready.then(setRegistration);
    return () => registration.unregister();
  }, [openArticle]);

  /*
   * Opening the article a shared link names is this page synchronising itself with the network, and
   * the request it starts reports that it is loading. That is the one setState an effect should be
   * allowed, and the rule cannot tell it apart from a cascade.
   */
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    if (start.article) void openArticle(start.article.lang, start.article.title);
  }, [openArticle, start]);

  /*
   * Reading another article is going somewhere, so it takes its own history entry and the back
   * button returns to the article before it. Reopening the same one and moving the sensitivity are
   * the same place seen differently, and rewrite the entry in place.
   */
  useEffect(() => {
    /*
     * A shared link's own URL stands until its article is open: until then this page knows nothing
     * the URL does not already say, and writing over it would drop the title the reader arrived on.
     */
    if (!article && start.article && writtenRef.current === undefined) return;
    const target: SharedArticle | null = article ? { lang: article.lang, title: article.title } : null;
    const action = historyActionFor(writtenRef.current, target);
    writtenRef.current = target;
    const params = new URLSearchParams();
    params.set("sensitivity", String(policy.sensitivity));
    if (target) {
      params.set("lang", target.lang);
      params.set("title", target.title);
    }
    const url = `?${params}`;
    if (action === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }, [article, policy.sensitivity, start.article]);

  /*
   * The browser has already moved by the time this fires, so the entry it landed on is where the
   * reader is rather than somewhere to add. The sensitivity in that URL is left alone: it is the
   * reader's setting now, not a property of the page they went back to.
   */
  useEffect(() => {
    const onPopState = () => {
      const target = readArticleTarget(window.location.search);
      writtenRef.current = target;
      if (target) void openArticle(target.lang, target.title);
      else closeArticle();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [closeArticle, openArticle]);

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

  const counts = useMemo(() => (article ? countHidden(article, policy) : null), [article, policy]);

  const scannedHeadings = useMemo(() => {
    if (!article) return [];
    const ids = scannedForArticle(scanned, article);
    return article.sections.filter((section) => ids.includes(section.id)).map(sectionHeading);
  }, [article, scanned]);

  const elsewhere = useMemo(() => scannedElsewhere(scanned, article), [article, scanned]);

  const openedOnPage = useMemo(() => ledgerRows(revealedOnPage(article, policy)), [article, policy]);

  const openedCount = sentenceTotal(openedOnPage);

  const readCount = scannedHeadings.length + elsewhere.reduce((total, group) => total + group.sections, 0);

  /** Only a sensitivity the reader or their agent chose is remembered; one that arrived in a link is not. */
  const chooseSensitivity = useCallback((sensitivity: number) => {
    window.localStorage.setItem(SENSITIVITY_KEY, String(sensitivity));
    setPolicy((current) => ({ ...current, sensitivity }));
  }, []);

  /**
   * The reader reaching for a sentence lands in the same two sets the agent's decisions do, so a
   * tap can take back what an agent hid and an agent can take back what the wording rules withheld.
   * Only `apply_mask` writes to `decisions`: what the reader did to their own page is on the page.
   */
  const reveal = (sentenceIds: string[]) => setPolicy((current) => maskWith(current, sentenceIds, []));

  const hide = (sentenceIds: string[]) => setPolicy((current) => maskWith(current, [], sentenceIds));

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

  const revealedBefore = useRef(policy.shown);
  /*
   * Runs before the browser paints: the sentences a reveal opens must be drawn as flowing words
   * from their very first frame, or the whole sentence shows for an instant before the words start.
   */
  useLayoutEffect(() => {
    const before = revealedBefore.current;
    revealedBefore.current = policy.shown;
    const opened = [...policy.shown].filter((id) => !before.has(id));
    const closed = [...before].filter((id) => !policy.shown.has(id));
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
  }, [flowSource, policy.shown]);

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
          </section>

          <Panel title="Your agent's decisions" count={policy.decisions.length}>
            <Decisions decisions={policy.decisions} />
          </Panel>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <Panel title="Revealed on your page" count={openedCount}>
              <Ledger
                title="Revealed on your page"
                rows={openedOnPage}
                className="border border-line bg-surface text-mask-ink"
              />
            </Panel>
            <Panel title="Your agent has read" count={readCount}>
              <HasRead sections={scannedHeadings} elsewhere={elsewhere} />
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
          <SearchBox lang={lang} onLang={setLang} onOpen={(title) => void openArticle(lang, title)} />

          {!article && !loading && (
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

          {loading && <ArticleSkeleton />}
          {error && <p className="mt-6 text-sm text-alert-text">{error}</p>}

          {!loading && article && (
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

function ledgerRows(disclosures: SectionDisclosure[]): LedgerRow[] {
  return disclosures.map(({ section, ids }) => ({
    sectionId: section.id,
    label: sectionHeading(section),
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
 * What the agent decided, in the words it gave for deciding it, newest first. The agent's judgement
 * is the only part of the filtering that is not written down anywhere else on the page, so this is
 * where the reader checks that what they are looking at is what they asked for.
 */
function Decisions({ decisions }: { decisions: Decision[] }) {
  const newestFirst = [...decisions].reverse();
  return (
    <section>
      <h3 className="font-semibold">Your agent&apos;s decisions</h3>
      {newestFirst.length === 0 ? (
        <p className="mt-1 text-xs text-muted">Nothing yet. Ask your agent to filter this page.</p>
      ) : (
        <ul className="mt-1 space-y-1 text-xs">
          {newestFirst.map((decision, index) => (
            <li key={newestFirst.length - index} className="rounded-lg border border-line bg-surface px-3 py-2">
              <span className="block">{decision.reason}</span>
              <span className="block tabular-nums text-muted">
                {decision.show.length} shown · {decision.hide.length} hidden
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The sections the agent has read in full, which is every section it was asked to judge. It knows
 * those endings for the rest of the conversation, so the reader is told which ones rather than
 * left to infer it from what came back masked.
 */
function HasRead({
  sections,
  elsewhere,
}: {
  sections: string[];
  elsewhere: { articleTitle: string; sections: number }[];
}) {
  return (
    <section>
      <h3 className="font-semibold">Your agent has read</h3>
      {sections.length === 0 && elsewhere.length === 0 && <p className="mt-1 text-xs text-muted">Nothing yet.</p>}
      {sections.length > 0 && (
        <p className="mt-1 rounded-lg bg-alert-surface px-3 py-2 text-xs text-alert-ink">
          {sections.join(", ")}. It knows those spoilers for the rest of this conversation.
        </p>
      )}
      {elsewhere.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-muted">
          {elsewhere.map((group) => (
            <li key={group.articleTitle}>
              {group.articleTitle} — {group.sections === 1 ? "1 section" : `${group.sections} sections`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * What this page has opened on the reader's screen, section by section. It stays on screen empty,
 * so the absence of a disclosure is as visible as a disclosure.
 */
function Ledger({ title, rows, className }: { title: string; rows: LedgerRow[]; className: string }) {
  return (
    <section>
      <h3 className="font-semibold">{title}</h3>
      {rows.length === 0 && <p className="mt-1 text-xs text-muted">Nothing yet.</p>}
      {rows.length > 0 && (
        <ul className={`mt-1 space-y-0.5 rounded-lg px-3 py-2 text-xs ${className}`}>
          {rows.map((row) => (
            <li key={row.sectionId}>
              {row.label} — {sentenceCount(row.sentences)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const SUGGESTIONS_ID = "search-suggestions";

const optionId = (index: number) => `search-suggestion-${index}`;

/**
 * One field does the whole job. The reader types, the page searches, and what it finds drops under
 * the box: there is no button to press, and the edition to look in is the only other control, small
 * and inside the field. Enter opens the row the box is offering, so the shortest path from a term to
 * an article is to type it and press Enter.
 */
function SearchBox({
  lang,
  onLang,
  onOpen,
}: {
  lang: Lang;
  onLang: (lang: Lang) => void;
  onOpen: (title: string) => void;
}) {
  const [term, setTerm] = useState("");
  const [composing, setComposing] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  /*
   * Coming back to the field offers what it holds for replacing, so a term left over from the last
   * search is typed over rather than edited around. Arriving by pointer waits for the button to come
   * up before deciding: a click selects the term, and a drag keeps the range the reader drew. This is
   * the ref that tells a press bringing the focus in from one inside a field that already has it.
   */
  const arriving = useRef(false);
  const { hits, active, error, move, searchNow, dismiss } = useSuggestions(lang, term, composing);

  /*
   * Opening a suggestion leaves its title in the field, so what the reader searched for becomes what
   * they found. The title is the page answering rather than the reader asking, so it is dismissed as
   * it is written: the box does not turn round and search for what it has just been handed.
   */
  const open = (chosen: string) => {
    dismiss(chosen);
    setTerm(chosen);
    onOpen(chosen);
  };

  const steer = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      const chosen = hits[active];
      if (chosen) open(chosen.title);
      else searchNow();
    } else if (event.key === "Escape") {
      dismiss(term);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (hits.length === 0) return;
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    }
  };

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) dismiss(term);
      }}
    >
      <div className="flex items-center gap-2 rounded-lg border border-edge bg-surface py-1 pr-1 pl-3 focus-within:border-edge-hover">
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
          className="size-4 shrink-0 text-faint"
        >
          <circle cx="9" cy="9" r="5.25" />
          <path d="M13 13 17 17" strokeLinecap="round" />
        </svg>
        <input
          ref={field}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onKeyDown={steer}
          onMouseDown={() => {
            arriving.current = document.activeElement !== field.current;
          }}
          onFocus={(event) => {
            if (!arriving.current) event.currentTarget.select();
          }}
          onMouseUp={(event) => {
            const drawn = event.currentTarget.selectionStart !== event.currentTarget.selectionEnd;
            if (arriving.current && !drawn) event.currentTarget.select();
            arriving.current = false;
          }}
          placeholder="Search Wikipedia for a film, series or novel"
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls={hits.length > 0 ? SUGGESTIONS_ID : undefined}
          aria-autocomplete="list"
          aria-activedescendant={active < 0 ? undefined : optionId(active)}
          className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-faint"
        />
        <div
          role="group"
          aria-label="Search language"
          className="flex shrink-0 gap-0.5 rounded-full bg-raised p-0.5"
        >
          {/* Switching edition keeps the caret where it was, so the reader carries on typing. */}
          {LANGUAGES.map((option) => (
            <button
              key={option.lang}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onLang(option.lang)}
              aria-pressed={lang === option.lang}
              title={option.title}
              className={`rounded-full px-2 py-1 text-xs font-medium ${
                lang === option.lang ? "bg-ink text-inverse" : "text-muted hover:text-ink"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p className="absolute inset-x-0 top-full z-20 mt-1 rounded-lg border border-alert-line bg-alert-surface px-4 py-3 text-xs text-alert-ink">
          {error}
        </p>
      )}
      {hits.length > 0 && (
        <ul
          id={SUGGESTIONS_ID}
          role="listbox"
          aria-label="Suggested articles"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-[min(60vh,24rem)] divide-y divide-line overflow-y-auto rounded-lg border border-line bg-surface shadow-lg"
        >
          {/*
            * The row is the option itself rather than a button inside one: the list is driven from the
            * field, so a pointer needs somewhere to click and a screen reader needs the row to be the
            * thing that is selected. Holding the mouse down keeps the field focused, so the list is
            * still there when the click lands.
            */}
          {hits.map((hit, index) => (
            <li
              key={hit.title}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => open(hit.title)}
              className={`cursor-pointer px-4 py-2.5 ${index === active ? "bg-raised" : "hover:bg-row-hover"}`}
            >
              <span className="block truncate text-sm font-medium">{hit.title}</span>
              <span className="block truncate text-xs text-muted">{hit.snippet}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * An article on its way, in the shape of the article it will be: the title, the line of counts under
 * it, the lead paragraph that carries no heading of its own, then sections that do. Every band
 * stands at the size and the leading the real text uses, so the words land about where the bands
 * were rather than shifting the page as they arrive.
 */
const PENDING_SECTIONS = [
  { heading: false, lines: ["w-full", "w-full", "w-2/3"] },
  { heading: true, lines: ["w-full", "w-11/12", "w-full", "w-1/2"] },
  { heading: true, lines: ["w-full", "w-full", "w-3/5"] },
];

const PENDING_BAND = "unspoiled-pending rounded bg-raised";

function ArticleSkeleton() {
  return (
    <article aria-busy="true" className="mt-6">
      <span className="sr-only">Loading article</span>
      <div className={`${PENDING_BAND} h-8 w-1/2`} />
      <div className={`${PENDING_BAND} mt-1 h-4 w-1/4`} />
      {PENDING_SECTIONS.map((pending, section) => (
        <section key={section} className="mt-6">
          {pending.heading && (
            <div className="border-b border-line pb-1">
              <div className={`${PENDING_BAND} h-7 w-1/3`} />
            </div>
          )}
          <div className="mt-3">
            {/* A band the height of a glyph inside a row the height of a line, so the rhythm is the text's. */}
            {pending.lines.map((width, line) => (
              <div key={line} className="flex h-7 items-center">
                <div className={`${PENDING_BAND} h-3 ${width}`} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </article>
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
  const groups = section.paragraphs.map((paragraph) => groupSentences(paragraph, section, policy));
  const hidden = groups.reduce(
    (total, group) => total + group.reduce((count, run) => count + (run.hidden ? run.sentences.length : 0), 0),
    0,
  );
  const withheld = groups.filter((group) => group.every((run) => run.hidden)).length;
  const opened = section.paragraphs.flatMap((paragraph) =>
    paragraph.sentences.filter((sentence) => policy.shown.has(sentence.id)).map((sentence) => sentence.id),
  );

  return (
    <section className="mt-6">
      <SectionHeading section={section} hidden={hidden} opened={opened} onHide={onHide} />
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
                      onHide={policy.shown.has(sentence.id) ? onHide : null}
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
    const timedRuns = [];
    let start = 0;
    for (const pieces of flowRuns(runs, lang)) {
      timedRuns.push(pieces.map((piece, index) => ({ piece, delay: flowDelay(start + index, timing) })));
      start += pieces.length;
    }
    return timedRuns;
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

/**
 * A heading names its section and is never withheld: an agent that cannot say which section it
 * masked cannot explain its own decision, and the reader cannot check it. The lead has no heading in
 * the article, so the page does not invent one for it — only the counts the heading row carries stay,
 * on a line of their own, and that line is there only when it has something to say.
 */
function SectionHeading({
  section,
  hidden,
  opened,
  onHide,
}: {
  section: Section;
  hidden: number;
  opened: string[];
  onHide: (ids: string[]) => void;
}) {
  const counts = (
    <>
      {hidden > 0 && (
        <span className="rounded bg-raised px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-mask-ink">
          {hidden} withheld
        </span>
      )}
      {opened.length > 1 && (
        <button
          onClick={() => onHide(opened)}
          className="rounded bg-mask px-1.5 py-0.5 text-[11px] font-medium text-mask-ink hover:bg-mask-hover"
        >
          Hide {opened.length} sentences again
        </button>
      )}
    </>
  );

  if (isLead(section)) {
    if (hidden === 0 && opened.length <= 1) return null;
    return <div className="flex flex-wrap items-baseline gap-2">{counts}</div>;
  }

  return (
    <h3 className="flex flex-wrap items-baseline gap-2 border-b border-line pb-1 text-lg font-semibold">
      {sectionHeading(section)}
      {counts}
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
