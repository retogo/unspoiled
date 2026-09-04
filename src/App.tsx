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
  type RefObject,
} from "react";
import { flowDelay, flowRuns, flowTimings, flowWords, type FlowTiming } from "./lib/flow";
import { bottomOverlap, scrollToFollow } from "./lib/scroll";
import { maskRows } from "./lib/mask";
import {
  assessSection,
  countHidden,
  hiddenSentenceReason,
  maskWith,
  ruleDecisions,
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
import { countMatching, namedRules, type Rule, type RuleDraft, type RuleOrigin, type RuleScope } from "./lib/rules";
import {
  allRules,
  articleKey,
  historyActionFor,
  policyForOpened,
  readArticleTarget,
  readRuleStore,
  readSessionStart,
  recordScanned,
  RULES_KEY,
  rulesFor,
  scannedElsewhere,
  scannedForArticle,
  storedWith,
  storedWithout,
  type RuleStore,
  type ScannedSection,
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

/**
 * Five points on the scale worth a name, marked where they fall along the slider. Each name says
 * what it takes off the screen rather than how strict it is: a reader knows whether they want the
 * ending kept from them, not whether they want the dial at seventy.
 */
const SENSITIVITY_PRESETS: { sensitivity: number; label: string; hint: string }[] = [
  {
    sensitivity: 0,
    label: "Show everything",
    hint: "The page hides nothing on its own. Your agent's decisions and your rules still apply.",
  },
  { sensitivity: 20, label: "Ending only", hint: "Hides the final scene, who dies, who did it." },
  {
    sensitivity: 45,
    label: "Major spoilers",
    hint: "Hides endings, deaths, identities, winners and major reveals.",
  },
  {
    sensitivity: 65,
    label: "Spoiler-safe",
    hint: "Hides whole plot summaries, analysis, and wording that hints at the ending.",
  },
  {
    sensitivity: 100,
    label: "Maximum protection",
    hint: "Hides anything the page finds even slightly suspicious.",
  },
];

/** Which Wikipedia to search. The pair sits inside the field: a search is a term and an edition. */
const LANGUAGES: { lang: Lang; label: string; title: string }[] = [
  { lang: "en", label: "EN", title: "Search the English Wikipedia" },
  { lang: "ja", label: "JA", title: "Search the Japanese Wikipedia" },
];

/** Where a new rule applies. The article it was made on is the safer default, so it comes first. */
const RULE_SCOPES: { scope: RuleScope; label: string }[] = [
  { scope: "article", label: "This article only" },
  { scope: "all", label: "Every article" },
];

/* One button rather than three, so the icon has to carry the whole state. Stroked in the current
   colour and sized to the header line, like the marks beside a rule. */
function SunMark() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-4"
    >
      <circle cx="8" cy="8" r="3.25" />
      <path d="M8 1.25v1.5M8 13.25v1.5M14.75 8h-1.5M2.75 8h-1.5M12.77 3.23l-1.06 1.06M4.29 11.71l-1.06 1.06M12.77 12.77l-1.06-1.06M4.29 4.29L3.23 3.23" />
    </svg>
  );
}

function MoonMark() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-4"
    >
      <path d="M13.5 9.75A5.75 5.75 0 0 1 6.25 2.5a5.75 5.75 0 1 0 7.25 7.25Z" />
    </svg>
  );
}

function MonitorMark() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-4"
    >
      <rect x="1.75" y="2.75" width="12.5" height="8.5" rx="1.5" />
      <path d="M5.75 14.25h4.5M8 11.25v3" />
    </svg>
  );
}

/*
 * The three the control turns through, in the order it turns through them. `system` comes last
 * because it is where the page starts and where a reader who has changed their mind hands it back.
 */
const THEMES: { choice: ThemeChoice; label: string; Mark: () => ReactNode }[] = [
  { choice: "light", label: "Light", Mark: SunMark },
  { choice: "dark", label: "Dark", Mark: MoonMark },
  { choice: "system", label: "System", Mark: MonitorMark },
];

/**
 * What the slider is doing, in the words of the strongest named point it has reached. A value
 * between two presets is at least as protective as the one below it, so that is the one it reads as.
 */
function sensitivityHint(sensitivity: number): string {
  const reached = SENSITIVITY_PRESETS.filter((preset) => preset.sensitivity <= sensitivity);
  return reached[reached.length - 1].hint;
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

function plural(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}

/** The clock, not the calendar: a decision is placed within the session, not within the year. */
function atTime(at: number): string {
  const when = new Date(at);
  return `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
}

/**
 * What a decision says of itself as it lands. A mask is a count, because the reader can watch the
 * sentences it moved; a rule is its label, because they cannot, and the label is the one part of a
 * rule the page will put on the screen.
 */
function decisionSummary(decision: Decision): string {
  if (decision.kind === "mask") {
    return `Your agent showed ${sentenceCount(decision.show.length)} and hid ${decision.hide.length}`;
  }
  return `Your agent will always hide ${decision.label}`;
}

/** The size of a decision, in the terms its own kind is measured by. */
function decisionScale(decision: Decision): string {
  if (decision.kind === "mask") {
    return `${decision.show.length} shown · ${decision.hide.length} hidden`;
  }
  return `always hides ${decision.label} · ${decision.scope === "all" ? "every article" : "this article"}`;
}

/** Long enough to read a reason, short enough that the reader is not made to dismiss it. */
const NOTICE_MS = 12000;

export default function App() {
  const [start] = useState(() =>
    readSessionStart(
      window.location.search,
      window.localStorage.getItem(SENSITIVITY_KEY),
      rulesFor(readRuleStore(window.localStorage.getItem(RULES_KEY)), readArticleTarget(window.location.search)),
    ),
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
  const [ruleStore, setRuleStore] = useState<RuleStore>(() =>
    readRuleStore(window.localStorage.getItem(RULES_KEY)),
  );
  const [rulesOpen, setRulesOpen] = useState(false);
  const [notice, setNotice] = useState<Decision | null>(null);
  const [reading, setReading] = useState(false);

  /*
   * The tools are handed to the browser once, on mount, and are called long afterwards, so they read
   * the page through refs rather than through the render that registered them. The refs are caught
   * up after each commit: a render that wrote to them would be a render with a side effect, which is
   * both a lie about the render and enough to stop the compiler optimising anything here.
   */
  const articleRef = useRef<Article | null>(null);
  const policyRef = useRef<Policy>(policy);
  const scannedRef = useRef<ScannedSection[]>(scanned);
  const ruleStoreRef = useRef<RuleStore>(ruleStore);
  const openRequestRef = useRef(0);
  const writtenRef = useRef<SharedArticle | null | undefined>(undefined);
  useLayoutEffect(() => {
    articleRef.current = article;
    policyRef.current = policy;
    scannedRef.current = scanned;
    ruleStoreRef.current = ruleStore;
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
      const opening = policyForOpened(
        policyRef.current,
        articleRef.current,
        opened,
        rulesFor(ruleStoreRef.current, opened),
      );
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
    setPolicy((current) => ({ ...current, rules: rulesFor(ruleStoreRef.current, null) }));
  }, []);

  /**
   * A rule is the reader's own setting rather than anything about the article, so it is written
   * down as it is made, and the policy is handed whichever rules apply to what is on screen now.
   * An agent's rule is also a decision made for the reader, so it joins the record beside the
   * masks, named with the article it was made on.
   */
  const keepRules = useCallback((next: RuleStore, added: readonly Rule[] = []): Policy => {
    window.localStorage.setItem(RULES_KEY, JSON.stringify(next));
    setRuleStore(next);
    /* A rule starts withholding sentences the moment it lands, so adding one opens the drawer that
       shows its row: a rule the reader cannot see is a rule filtering silently. Taking one down
       does not, and neither does anything else. */
    if (added.length > 0) setRulesOpen(true);
    const open = articleRef.current;
    const recorded = open
      ? ruleDecisions(added, Date.now(), {
          articleKey: articleKey(open.lang, open.title),
          articleTitle: open.displayTitle,
        })
      : [];
    const kept: Policy = {
      ...policyRef.current,
      rules: rulesFor(next, open),
      decisions: [...policyRef.current.decisions, ...recorded],
    };
    setPolicy(kept);
    return kept;
  }, []);

  /**
   * The page names each rule and files it where its scope says, so neither the reader nor their
   * agent can overwrite a rule already there. The policy it made is handed back, because the tool
   * has to report what the reader is now seeing without waiting for a re-render.
   */
  const addRules = useCallback(
    (drafts: RuleDraft[]) => {
      const open = articleRef.current;
      const store = ruleStoreRef.current;
      const added = namedRules(drafts, allRules(store), Date.now());
      const next = storedWith(store, open ? articleKey(open.lang, open.title) : null, added);
      return { added, policy: keepRules(next, added) };
    },
    [keepRules],
  );

  const addRule = useCallback(
    (phrase: string, scope: RuleScope) => {
      const wanted = phrase.trim();
      if (wanted === "") return;
      addRules([{ phrases: [wanted], label: wanted, scope, origin: "reader" }]);
    },
    [addRules],
  );

  const removeRule = useCallback((id: string) => {
    keepRules(storedWithout(ruleStoreRef.current, id));
  }, [keepRules]);

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
        addRules,
      }),
      (call) => setCalls((current) => [call, ...current].slice(0, 25)),
    );
    void registration.ready.then(setRegistration);
    return () => registration.unregister();
  }, [addRules, openArticle]);

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

  /*
   * A decision lands while the reader is reading, so it says so once, in passing, and then gets out
   * of the way — the record of it stays in the drawer under the article. Only `apply_mask` writes to
   * `decisions`, so a reader opening a sentence for themselves is never announced back to them.
   */
  const activityRef = useRef<HTMLDetailsElement | null>(null);
  const announcedRef = useRef(policy.decisions.length);
  useEffect(() => {
    const announced = announcedRef.current;
    announcedRef.current = policy.decisions.length;
    if (policy.decisions.length === announced) return;
    setNotice(policy.decisions.at(-1) ?? null);
  }, [policy.decisions]);

  /* A reader who has reached for the notice is reading it, and nothing is taken away mid-sentence. */
  useEffect(() => {
    if (!notice || reading) return;
    const fade = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(fade);
  }, [notice, reading]);

  const openActivity = useCallback(() => {
    setNotice(null);
    setReading(false);
    const drawer = activityRef.current;
    if (!drawer) return;
    drawer.open = true;
    /* The drawer can be tens of thousands of pixels down a long article, which is too far to travel
       smoothly: the reader asked to see it, so the page goes there the way a link does. */
    drawer.scrollIntoView({ block: "center" });
  }, []);

  /** Only a sensitivity the reader or their agent chose is remembered; one that arrived in a link is not. */
  const chooseSensitivity = useCallback((sensitivity: number) => {
    window.localStorage.setItem(SENSITIVITY_KEY, String(sensitivity));
    setPolicy((current) => ({ ...current, sensitivity }));
  }, []);

  /** Every sentence of the article as text, which is what a rule is matched against. */
  const sentenceTexts = useMemo(
    () =>
      (article?.sections ?? []).flatMap((section) =>
        section.paragraphs.flatMap((paragraph) => paragraph.sentences.map((sentence) => sentence.text)),
      ),
    [article],
  );

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

  const registrationLine =
    registration.api === "unavailable"
      ? "No agent connected — reading on your own"
      : registration.error
        ? `This page could not expose its tools — ${registration.error}`
        : `${registration.toolCount} tools exposed via ${registration.api}`;

  return (
    <div className="min-h-screen bg-paper pb-24 text-ink lg:pb-0">
      {/*
        The search field is how the reader gets anywhere on this page, so it sits in the header
        rather than at the top of the column, in the same place whether or not an article is open.
        The header is positioned so that the suggestions the field drops come down over the article
        rather than under it. Below `lg` the field takes a line of its own beneath the rest.
      */}
      <header className="relative z-30 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
          <h1 className="text-xl font-semibold tracking-tight">Unspoiled</h1>
          <div className="order-last w-full lg:order-none lg:w-auto lg:flex-1">
            <SearchBox lang={lang} onLang={setLang} onOpen={(title) => void openArticle(lang, title)} />
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <ThemeToggle theme={theme} onChoose={chooseTheme} />
            {/*
              The badge is the longest thing on the line and the least urgent, so on a narrow screen
              it is what gives: capped and cut short so the logo and the theme keep their line, with
              the whole of it a press away. Given room, it says itself in full.
            */}
            <span
              title={registrationLine}
              className={`max-w-40 truncate rounded-full px-2.5 py-1 text-xs font-medium lg:max-w-none ${
                registration.api === "unavailable"
                  ? "bg-raised text-muted"
                  : registration.error
                    ? "bg-warn-surface text-warn-ink"
                    : "bg-ok-surface text-ok-ink"
              }`}
            >
              {registrationLine}
            </span>
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
              {/*
                Five names will not fit across the width of the sidebar — the two that matter most
                to a reader deciding are also the longest — so the scale is read downwards instead:
                a row each, with the point it stands for beside it. That number is what ties a row
                back to the slider above, and it is not part of what the row is called.
              */}
              <div
                role="group"
                aria-label="Named points on the scale"
                className="mt-2 mb-1.5 hidden flex-col lg:flex"
              >
                {SENSITIVITY_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => chooseSensitivity(preset.sensitivity)}
                    aria-pressed={policy.sensitivity === preset.sensitivity}
                    title={preset.hint}
                    className={`flex items-baseline justify-between gap-2 rounded px-1.5 py-1 text-left text-[11px] ${
                      policy.sensitivity === preset.sensitivity
                        ? "bg-raised font-medium text-ink"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    {preset.label}
                    <span aria-hidden="true" className="tabular-nums text-faint">
                      {preset.sensitivity}
                    </span>
                  </button>
                ))}
              </div>
              <p className="hidden text-xs leading-5 text-muted lg:block">{sensitivityHint(policy.sensitivity)}</p>
            </div>
          </section>

          {/*
            The reader's second control, and the only place an agent's rule is ever named. It sits
            under the slider, folded until there is something in it: a standing rule withholds at
            every sensitivity, so the drawer opens itself whenever one lands. Only phrases are
            behind a mask.
          */}
          <AlwaysHide
            rules={policy.rules}
            scoped={article !== null}
            matched={(rule) => countMatching(rule, sentenceTexts)}
            open={rulesOpen}
            onOpen={setRulesOpen}
            onAdd={addRule}
            onRemove={removeRule}
          />
        </aside>

        <div className="min-w-0">
          {/* What the page is for, and where to start, for a reader who has nothing open yet. */}
          {!article && !loading && (
            <>
              <p className="text-sm text-muted">Read Wikipedia without learning the ending.</p>
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
            </>
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
              {scannedHeadings.length > 0 && <ReadWarning sections={scannedHeadings} />}
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

          {article && (
            <AgentActivity
              decisions={policy.decisions}
              openKey={articleKey(article.lang, article.title)}
              calls={calls}
              elsewhere={elsewhere}
              drawerRef={activityRef}
            />
          )}
        </div>
      </main>

      {/*
        A live region that is always in the page, so what lands in it is announced rather than
        arriving as a new region the reader is never told about.
      */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-5 bottom-24 z-20 lg:inset-x-auto lg:right-6 lg:bottom-6 lg:max-w-xs"
      >
        {notice && (
          <button
            onClick={openActivity}
            onMouseEnter={() => setReading(true)}
            onMouseLeave={() => setReading(false)}
            onFocus={() => setReading(true)}
            onBlur={() => setReading(false)}
            className="unspoiled-mask pointer-events-auto w-full rounded-lg border border-line bg-surface px-3 py-2 text-left text-xs shadow-lg"
          >
            <span className="block font-medium">{decisionSummary(notice)}</span>
            <span className="block text-muted">{notice.reason}</span>
          </button>
        )}
      </div>

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

/**
 * The theme, as one button that turns through the three. An icon says where it is now, and its name
 * says that and where the next press goes, because a reader who cannot see the icon would otherwise
 * be pressing a button that never says what it does.
 */
function ThemeToggle({ theme, onChoose }: { theme: ThemeChoice; onChoose: (choice: ThemeChoice) => void }) {
  const at = THEMES.findIndex((option) => option.choice === theme);
  const current = THEMES[at];
  const next = THEMES[(at + 1) % THEMES.length];
  const name = `Theme: ${current.label}. Switch to ${next.label}`;

  return (
    <button
      onClick={() => onChoose(next.choice)}
      aria-label={name}
      title={name}
      className="rounded-full p-1.5 text-muted hover:bg-raised hover:text-ink"
    >
      <current.Mark />
    </button>
  );
}

/** How many sections the warning names before it starts counting them instead. */
const NAMED_SECTIONS = 4;

/**
 * The one thing about the agent the reader cannot afford to miss, so it stands in front of the
 * article rather than beside it: the sections it has read in full, which are the sections whose
 * endings it now knows. There is nothing to dismiss it with, because reading cannot be undone and a
 * warning the reader can close is a warning they will close.
 *
 * An agent asked to read an article reads most of it, and a banner naming fifteen sections runs off
 * the line and stops being read at all. So the first few are named and the rest are counted: the
 * reader still learns that their agent knows more than the banner has room to say, and the whole
 * list is on the banner itself for anyone who wants it.
 */
function ReadWarning({ sections }: { sections: string[] }) {
  const named = sections.slice(0, NAMED_SECTIONS);
  const rest = sections.length - named.length;
  return (
    <div className="mt-3 rounded-lg bg-warn-surface px-3 py-2 text-xs text-warn-ink">
      <p className="font-medium" title={rest > 0 ? sections.join(", ") : undefined}>
        {`Your agent has read: ${rest > 0 ? `${named.join(", ")} and ${rest} more` : named.join(", ")}`}
      </p>
      <p className="mt-0.5">
        In this conversation your agent knows what those sections say, even where the page still
        withholds them.
      </p>
    </div>
  );
}

/**
 * The phrases this reader never wants to meet. A rule is a phrase rather than a sentence id, so it
 * holds over every sentence of the article and at every sensitivity, including the one that
 * withholds nothing else. The reader can still tap a sentence back, and can take the rule down.
 */
function AlwaysHide({
  rules,
  scoped,
  matched,
  open,
  onOpen,
  onAdd,
  onRemove,
}: {
  rules: Rule[];
  scoped: boolean;
  matched: (rule: Rule) => number;
  /**
   * Whether the drawer stands open. It is the page's rather than this component's, because what
   * opens it is a rule landing, and a rule can land from the agent while the reader is elsewhere.
   * Folding it away again is theirs, and is not remembered past the session.
   */
  open: boolean;
  onOpen: (open: boolean) => void;
  onAdd: (phrase: string, scope: RuleScope) => void;
  onRemove: (id: string) => void;
}) {
  const [phrase, setPhrase] = useState("");
  const [scope, setScope] = useState<RuleScope>("article");

  return (
    <details
      open={open}
      onToggle={(event) => onOpen(event.currentTarget.open)}
      className="rounded-lg border border-line bg-surface px-3 py-2"
    >
      <summary className="cursor-pointer font-semibold">
        {rules.length > 0 ? `Always hide · ${rules.length}` : "Always hide"}
      </summary>
      <p className="mt-1 text-xs text-muted">
        Every sentence carrying one of these comes off the page, whatever the slider says.
      </p>
      <input
        aria-label="A word or phrase to always hide"
        placeholder="A name, a place, an episode"
        value={phrase}
        onChange={(event) => setPhrase(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          onAdd(phrase, scope);
          setPhrase("");
        }}
        className="mt-1.5 w-full rounded-lg border border-edge bg-surface px-2.5 py-1.5 text-sm placeholder:text-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      />
      {/* A rule made where no article is open has no article to belong to, so it follows the reader. */}
      {scoped && (
        <div
          role="group"
          aria-label="Where a new phrase applies"
          className="mt-1.5 flex gap-0.5 rounded-full bg-raised p-0.5"
        >
          {RULE_SCOPES.map((option) => (
            <button
              key={option.scope}
              onClick={() => setScope(option.scope)}
              aria-pressed={scope === option.scope}
              className={`flex-1 rounded-full px-2 py-1 text-xs font-medium ${
                scope === option.scope ? "bg-ink text-inverse" : "text-muted hover:text-ink"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      {rules.length > 0 && (
        <ul aria-label="Phrases always hidden" className="mt-1.5 space-y-1 text-xs">
          {rules.map((rule) => (
            <RuleRow key={rule.id} rule={rule} matched={matched(rule)} onRemove={onRemove} />
          ))}
        </ul>
      )}
    </details>
  );
}

/*
 * Icons rather than words for who made a rule: the row already carries a label, a reason and a
 * count, and a fourth piece of text would crowd out the three that say what the rule does. They are
 * stroked in the current colour and sized to the line they sit in, and the name is on the wrapper
 * so a reader who cannot see them is told the same thing.
 */
function AgentMark() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-3.5"
    >
      <path d="M8 1.75v2.25" />
      <rect x="2.5" y="4" width="11" height="9.5" rx="2.75" />
      <path d="M6 7.75v1.5M10 7.75v1.5" />
    </svg>
  );
}

function ReaderMark() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-3.5"
    >
      <circle cx="8" cy="5.25" r="2.75" />
      <path d="M2.75 13.75a5.25 5.25 0 0 1 10.5 0" />
    </svg>
  );
}

const ORIGIN_MARKS: Record<RuleOrigin, { name: string; Mark: () => ReactNode }> = {
  agent: { name: "Added by your agent", Mark: AgentMark },
  reader: { name: "Added by you", Mark: ReaderMark },
};

/**
 * One standing rule, in three lines that read the same whoever made it: what is hidden, why, and
 * how far it reaches. The reader's own phrase is its own label. An agent's rule is shown by the
 * label and the reason it gave, and its phrases stand behind the same mask a withheld sentence
 * does: "the fate of a main character" is safe to read, and the phrase that catches it is the thing
 * the reader is avoiding.
 */
function RuleRow({
  rule,
  matched,
  onRemove,
}: {
  rule: Rule;
  matched: number;
  onRemove: (id: string) => void;
}) {
  const [showing, setShowing] = useState(false);
  const [reading, setReading] = useState(false);
  const phrases = rule.phrases.join(", ");
  const hide = () => setShowing(false);
  const { name, Mark } = ORIGIN_MARKS[rule.origin];

  return (
    <li className="rounded-lg border border-line bg-surface px-2.5 py-1.5">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 font-medium break-words">{rule.label}</span>
        <span role="img" aria-label={name} title={name} className="shrink-0 self-center text-faint">
          <Mark />
        </span>
      </div>
      {/*
        A reason can run to several lines, and the reader is looking for the rule rather than
        reading the agent. Two lines is enough to know which rule this is; the rest is one tap away.
      */}
      {rule.origin === "agent" && (
        <button
          onClick={() => setReading((open) => !open)}
          aria-expanded={reading}
          /* `line-clamp-2` sets its own display, so the open state is the only one that says `block`. */
          className={`mt-0.5 w-full text-left break-words text-muted ${reading ? "block" : "line-clamp-2"}`}
        >
          {rule.reason}
        </button>
      )}
      {/*
        The sidebar is too narrow to promise all three of these a line, so the buttons travel
        together: they sit out to the right of the count where there is room, and drop to a line of
        their own where there is not, rather than breaking the count across three ragged lines.
      */}
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-muted">
          {rule.scope === "all" ? "all articles" : "this article"} · {sentenceCount(matched)} withheld
        </span>
        <span className="ml-auto flex shrink-0 items-baseline gap-2">
          {rule.origin === "agent" && !showing && (
            <button
              onClick={() => setShowing(true)}
              aria-label="Show the phrases your agent added — they may contain spoilers"
              className="unspoiled-mask rounded bg-mask px-1.5 py-0.5 text-mask-ink hover:bg-mask-hover"
            >
              Show phrases
            </button>
          )}
          <button
            onClick={() => onRemove(rule.id)}
            aria-label={`Stop hiding ${rule.label}`}
            className="text-muted hover:text-ink"
          >
            Remove
          </button>
        </span>
      </div>
      {rule.origin === "agent" && showing && (
        <span
          role="button"
          tabIndex={0}
          aria-label={phrases}
          title="Hide these phrases again"
          onClick={hide}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            hide();
          }}
          className={`mt-1 block break-words ${OPENED}`}
        >
          {phrases}
        </span>
      )}
    </li>
  );
}

/**
 * Everything the agent has done to this page, kept where it can be checked rather than where it has
 * to be looked at: the decisions in the words the agent gave for them, and the calls underneath.
 * A reader who is reading does not need any of it, so it is folded away — each decision has already
 * said itself once as it landed, and this is where it is still findable afterwards.
 */
function AgentActivity({
  decisions,
  openKey,
  calls,
  elsewhere,
  drawerRef,
}: {
  decisions: Decision[];
  openKey: string;
  calls: ToolCall[];
  elsewhere: { articleTitle: string; sections: number }[];
  drawerRef: RefObject<HTMLDetailsElement | null>;
}) {
  const newestFirst = [...decisions].reverse();
  const summary = `Agent activity · ${plural(decisions.length, "decision")} · ${plural(calls.length, "call")}`;
  return (
    <details ref={drawerRef} className="mt-10 scroll-mt-6 rounded-lg border border-line bg-surface text-xs">
      <summary className="cursor-pointer px-3 py-2 font-medium text-muted">{summary}</summary>
      <div className="space-y-4 border-t border-line px-3 py-3">
        <section>
          <h4 className="font-semibold">Decisions</h4>
          {newestFirst.length === 0 ? (
            <p className="mt-1 text-muted">Nothing yet. Ask your agent to filter this page.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {newestFirst.map((decision, index) => (
                <li key={newestFirst.length - index} className="rounded-lg bg-paper px-3 py-2">
                  <span className="block tabular-nums text-muted">
                    {atTime(decision.at)} · {decisionScale(decision)}
                    {/* Which article, for a decision whose ids no longer name anything on screen. */}
                    {decision.articleKey !== openKey && ` · in ${decision.articleTitle}`}
                  </span>
                  <span className="block">{decision.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h4 className="font-semibold">Tool calls</h4>
          {calls.length === 0 ? (
            <p className="mt-1 text-muted">Nothing yet.</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {calls.map((call) => (
                <li key={`${call.at}-${call.tool}`} className="rounded bg-paper px-2 py-1">
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
        {elsewhere.length > 0 && (
          <section>
            <h4 className="font-semibold">Read elsewhere</h4>
            <ul className="mt-1 space-y-0.5 text-muted">
              {elsewhere.map((group) => (
                <li key={group.articleTitle}>
                  {group.articleTitle} — {plural(group.sections, "section")}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </details>
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
