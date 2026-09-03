import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  assessSection,
  countHidden,
  headingId,
  hiddenHeading,
  hiddenSentenceReason,
  isSectionKnown,
  type Policy,
} from "./lib/risk";
import { segmentArticle, sectionHeading, type Article, type Paragraph, type Section } from "./lib/segment";
import {
  articleKey,
  policyForOpened,
  readSessionStart,
  scannedElsewhere,
  scannedForArticle,
  type ScannedSection,
} from "./lib/session";
import { buildTools, type OpenResult } from "./lib/tools";
import { registerTools, type RegistrationState, type ToolCall } from "./lib/webmcp";
import { fetchArticle, searchArticles, type Lang, type SearchHit } from "./lib/wikipedia";

const DEMO_ARTICLES: { lang: Lang; title: string; note: string }[] = [
  { lang: "en", title: "The Sixth Sense", note: "the lead paragraph already gives it away" },
  { lang: "en", title: "Fight Club (film)", note: "the twist is in the reception section" },
  { lang: "en", title: "Attack on Titan", note: "episode lists spoil four seasons at once" },
  { lang: "ja", title: "シックス・センス", note: "日本語版でも同じことが起きる" },
];

const LEVEL_KEY = "unspoiled.level";

const POLICY_LEVELS: { level: Policy["level"]; label: string; hint: string }[] = [
  { level: "strict", label: "Strict", hint: "Withhold narrative and anything suspicious" },
  { level: "balanced", label: "Balanced", hint: "Withhold plot sections and outright reveals" },
  { level: "open", label: "Open", hint: "Show everything, your agent's withholding included" },
];

export default function App() {
  const [start] = useState(() => readSessionStart(window.location.search, window.localStorage.getItem(LEVEL_KEY)));
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
          if (next.level !== policyRef.current.level) window.localStorage.setItem(LEVEL_KEY, next.level);
          setPolicy(next);
        },
        openArticle: (toolLang, title) => openArticleRef.current(toolLang, title),
        scanned: () => scannedForArticle(scannedRef.current, articleRef.current),
        markScanned: (open, sectionId) => {
          const key = articleKey(open.lang, open.title);
          setScanned((current) =>
            current.some((entry) => entry.articleKey === key && entry.sectionId === sectionId)
              ? current
              : [...current, { articleKey: key, articleTitle: open.displayTitle, sectionId }],
          );
        },
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
    params.set("level", policy.level);
    if (article) {
      params.set("lang", article.lang);
      params.set("title", article.title);
    }
    window.history.replaceState(null, "", `?${params}`);
  }, [article, policy.level]);

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
      .map((section) => (hiddenHeading(section, policy) ? "a section whose heading is withheld" : sectionHeading(section)));
  }, [article, policy, scanned]);

  const elsewhere = useMemo(() => scannedElsewhere(scanned, article), [article, scanned]);

  /** Only a level the reader or their agent chose is remembered; one that arrived in a link is not. */
  const chooseLevel = useCallback((level: Policy["level"]) => {
    window.localStorage.setItem(LEVEL_KEY, level);
    setPolicy((current) => ({ ...current, level }));
  }, []);

  const reveal = (sentenceIds: string[]) =>
    setPolicy((current) => ({ ...current, revealed: [...new Set([...current.revealed, ...sentenceIds])] }));

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-4">
          <h1 className="text-xl font-semibold tracking-tight">Unspoiled</h1>
          <p className="text-sm text-zinc-500">Read Wikipedia without learning the ending.</p>
          <span
            className={`ml-auto rounded-full px-2.5 py-1 text-xs font-medium ${
              registration.api === "unavailable"
                ? "bg-zinc-100 text-zinc-500"
                : registration.error
                  ? "bg-amber-50 text-amber-900"
                  : "bg-emerald-50 text-emerald-700"
            }`}
          >
            {registration.api === "unavailable"
              ? "No agent connected — reading on your own"
              : registration.error
                ? `This page could not expose its tools — ${registration.error}`
                : `${registration.toolCount} tools exposed via ${registration.api}`}
          </span>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-6 px-5 py-6 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <select
              value={lang}
              onChange={(event) => setLang(event.target.value as Lang)}
              className="rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm"
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
              className="min-w-0 flex-1 basis-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm sm:basis-auto"
            />
            <button
              onClick={() => void search()}
              className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white"
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
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-left text-sm hover:border-zinc-400"
                >
                  <span className="font-medium">{demo.title}</span>
                  <span className="block text-xs text-zinc-500">{demo.note}</span>
                </button>
              ))}
            </div>
          )}

          {loading && <p className="mt-6 text-sm text-zinc-500">Loading…</p>}
          {error && <p className="mt-6 text-sm text-red-700">{error}</p>}

          {hits.length > 0 && (
            <ul className="mt-4 divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
              {hits.map((hit) => (
                <li key={hit.title}>
                  <button
                    onClick={() => void openArticle(lang, hit.title)}
                    className="block w-full px-4 py-3 text-left hover:bg-zinc-50"
                  >
                    <span className="text-sm font-medium">{hit.title}</span>
                    <span className="block text-xs text-zinc-500">{hit.snippet}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {article && (
            <article className="mt-6">
              <h2 className="text-2xl font-semibold tracking-tight">{article.displayTitle}</h2>
              <p className="mt-1 text-xs text-zinc-500">
                {counts?.hidden} of {counts?.total} sentences withheld ·{" "}
                <a className="underline" href={article.sourceUrl} target="_blank" rel="noreferrer">
                  original article
                </a>
              </p>
              {article.sections.map((section) => (
                <SectionView key={section.id} section={section} policy={policy} onReveal={reveal} />
              ))}
            </article>
          )}
        </div>

        <aside className="space-y-5 text-sm lg:sticky lg:top-6 lg:self-start">
          <section>
            <h3 className="font-semibold">Your policy</h3>
            <div className="mt-2 space-y-1">
              {POLICY_LEVELS.map((option) => (
                <button
                  key={option.level}
                  onClick={() => chooseLevel(option.level)}
                  className={`block w-full rounded-lg border px-3 py-2 text-left ${
                    policy.level === option.level
                      ? "border-ink bg-white font-medium"
                      : "border-zinc-200 bg-white/60 text-zinc-600"
                  }`}
                >
                  {option.label}
                  <span className="block text-xs text-zinc-500">{option.hint}</span>
                </button>
              ))}
            </div>
            {policy.alreadyKnows.length > 0 && (
              <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
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
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Your agent said: {policy.notes}
              </p>
            )}
          </section>

          {scanned.length > 0 && (
            <section>
              <h3 className="font-semibold">Your agent has read</h3>
              {scannedHeadings.length > 0 && (
                <p className="mt-1 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-900">
                  {scannedHeadings.join(", ")}. It knows those spoilers for the rest of this conversation.
                </p>
              )}
              {elsewhere.length > 0 && (
                <ul className="mt-1 space-y-1 text-xs text-zinc-500">
                  {elsewhere.map((group) => (
                    <li key={group.articleTitle}>
                      {group.articleTitle} — {group.sections === 1 ? "1 section" : `${group.sections} sections`}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section>
            <h3 className="font-semibold">Tool activity</h3>
            {calls.length === 0 ? (
              <p className="mt-1 text-xs text-zinc-500">Nothing yet. Ask your agent to filter this page.</p>
            ) : (
              <ul className="mt-1 space-y-1 text-xs">
                {calls.map((call) => (
                  <li key={`${call.at}-${call.tool}`} className="rounded bg-white px-2 py-1">
                    <code className="font-medium">{call.tool}</code>
                    {!call.ok && <span className="ml-1 font-medium text-red-700">error</span>}
                    <span className={`block ${call.ok ? "text-zinc-500" : "text-red-700"}`}>
                      {call.input} → {call.summary}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </main>

      <footer className="mx-auto max-w-5xl px-5 py-8 text-xs text-zinc-500">
        Article text from Wikipedia, licensed{" "}
        <a className="underline" href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">
          CC BY-SA 4.0
        </a>
        . Unspoiled is not affiliated with Wikipedia or the Wikimedia Foundation.
      </footer>
    </div>
  );
}

function SectionView({
  section,
  policy,
  onReveal,
}: {
  section: Section;
  policy: Policy;
  onReveal: (sentenceIds: string[]) => void;
}) {
  const risk = assessSection(section);
  const known = isSectionKnown(policy, section.id);
  const groups = section.paragraphs.map((paragraph) => groupSentences(paragraph, section, policy));
  const allHidden = groups.every((group) => group.every((run) => run.hidden));

  if (allHidden) {
    return (
      <section className="mt-6">
        <SectionHeading section={section} risk={risk} known={known} policy={policy} onReveal={onReveal} />
        <p className="mt-2 text-xs text-zinc-500">
          {section.paragraphs.length} paragraphs withheld — {risk.reason}. Plot summaries run in order, so you can
          open only as far as you have watched.
        </p>
        <div className="mt-2 space-y-1.5">
          {section.paragraphs.map((paragraph, index) => (
            <button
              key={paragraph.id}
              onClick={() => onReveal(paragraph.sentences.map((sentence) => sentence.id))}
              className="flex w-full items-baseline gap-2 rounded-lg border border-dashed border-zinc-300 bg-white px-3 py-2 text-left text-xs text-zinc-600 hover:border-zinc-400"
            >
              <span className="font-medium">Paragraph {index + 1}</span>
              <span className="text-zinc-400">
                {paragraph.sentences.length} sentences ·{" "}
                {paragraph.sentences.reduce((total, sentence) => total + sentence.text.length, 0)} chars
              </span>
              <span className="ml-auto underline">reveal</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="mt-6">
      <SectionHeading section={section} risk={risk} known={known} policy={policy} onReveal={onReveal} />
      {section.paragraphs.map((paragraph, index) => (
        <p key={paragraph.id} className="mt-3 leading-7">
          {groups[index].map((run) =>
            run.hidden ? (
              <button
                key={run.key}
                onClick={() => onReveal(run.sentences.map((sentence) => sentence.id))}
                title={run.reason}
                className="mx-0.5 rounded bg-zinc-200 px-2 py-0.5 align-baseline text-xs text-zinc-600 hover:bg-zinc-300"
              >
                {run.sentences.length === 1 ? "1 sentence" : `${run.sentences.length} sentences`} withheld · reveal
              </button>
            ) : (
              <span key={run.key}>
                {run.sentences.map((sentence) => sentence.text).join(" ")}{" "}
              </span>
            ),
          )}
        </p>
      ))}
    </section>
  );
}

function SectionHeading({
  section,
  risk,
  known,
  policy,
  onReveal,
}: {
  section: Section;
  risk: { level: string };
  known: string | null;
  policy: Policy;
  onReveal: (ids: string[]) => void;
}) {
  const withheldHeading = hiddenHeading(section, policy);
  return (
    <h3 className="flex flex-wrap items-baseline gap-2 border-b border-zinc-200 pb-1 text-lg font-semibold">
      {withheldHeading ? (
        <button
          onClick={() => onReveal([headingId(section)])}
          title={withheldHeading.reason}
          className="rounded bg-zinc-200 px-2 py-0.5 text-sm font-medium text-zinc-600 hover:bg-zinc-300"
        >
          Heading withheld · reveal
        </button>
      ) : (
        sectionHeading(section)
      )}
      {known ? (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
          shown — {known}
        </span>
      ) : (
        risk.level !== "safe" && (
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600">{risk.level}</span>
        )
      )}
    </h3>
  );
}

type SentenceRun = {
  key: string;
  hidden: boolean;
  reason?: string;
  sentences: { id: string; text: string }[];
};

function groupSentences(paragraph: Paragraph, section: Section, policy: Policy): SentenceRun[] {
  const runs: SentenceRun[] = [];
  for (const sentence of paragraph.sentences) {
    const withheld = hiddenSentenceReason(sentence, section, policy);
    const hidden = withheld !== null;
    const last = runs[runs.length - 1];
    if (last && last.hidden === hidden) {
      last.sentences.push(sentence);
      continue;
    }
    runs.push({ key: sentence.id, hidden, reason: withheld?.reason, sentences: [sentence] });
  }
  return runs;
}

/** A section the agent has read can still be one the reader is not allowed to see the name of. */
