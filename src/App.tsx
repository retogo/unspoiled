import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { assessSection, assessSentence, countHidden, defaultPolicy, isHidden, type Policy } from "./lib/risk";
import { segmentArticle, sectionHeading, type Article, type Paragraph, type Section } from "./lib/segment";
import { buildTools } from "./lib/tools";
import { registerTools, type RegistrationState, type ToolCall } from "./lib/webmcp";
import { fetchArticle, searchArticles, type Lang, type SearchHit } from "./lib/wikipedia";

const DEMO_ARTICLES: { lang: Lang; title: string; note: string }[] = [
  { lang: "en", title: "The Sixth Sense", note: "the lead paragraph already gives it away" },
  { lang: "en", title: "Fight Club (film)", note: "the twist is in the reception section" },
  { lang: "en", title: "Attack on Titan", note: "episode lists spoil four seasons at once" },
  { lang: "ja", title: "シックス・センス", note: "日本語版でも同じことが起きる" },
];

const POLICY_LEVELS: { level: Policy["level"]; label: string; hint: string }[] = [
  { level: "strict", label: "Strict", hint: "Withhold narrative and anything suspicious" },
  { level: "balanced", label: "Balanced", hint: "Withhold confirmed spoilers only" },
  { level: "open", label: "Open", hint: "Show everything" },
];

export default function App() {
  const [lang, setLang] = useState<Lang>("en");
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [article, setArticle] = useState<Article | null>(null);
  const [policy, setPolicy] = useState<Policy>(defaultPolicy);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registration, setRegistration] = useState<RegistrationState>({ api: "unavailable", toolCount: 0 });
  const [calls, setCalls] = useState<ToolCall[]>([]);
  const [scanned, setScanned] = useState<string[]>([]);

  const articleRef = useRef<Article | null>(null);
  const policyRef = useRef<Policy>(policy);
  const scannedRef = useRef<string[]>(scanned);
  articleRef.current = article;
  policyRef.current = policy;
  scannedRef.current = scanned;

  const openArticle = useCallback(async (nextLang: Lang, title: string) => {
    setLang(nextLang);
    setLoading(true);
    setError(null);
    setHits([]);
    try {
      const fetched = await fetchArticle(nextLang, title);
      setArticle(segmentArticle(fetched));
      setPolicy((current) => ({ ...current, revealed: [] }));
      setScanned([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  const openArticleRef = useRef(openArticle);
  openArticleRef.current = openArticle;

  useEffect(() => {
    const state = registerTools(
      buildTools({
        article: () => articleRef.current,
        policy: () => policyRef.current,
        setPolicy: (next) => setPolicy(next),
        openArticle: (toolLang, title) => void openArticleRef.current(toolLang, title),
        scanned: () => scannedRef.current,
        markScanned: (sectionId) =>
          setScanned((current) => (current.includes(sectionId) ? current : [...current, sectionId])),
      }),
      (call) => setCalls((current) => [call, ...current].slice(0, 25)),
    );
    setRegistration(state);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sharedTitle = params.get("title");
    const sharedLevel = params.get("level") as Policy["level"] | null;
    const storedLevel = window.localStorage.getItem("unspoiled.level") as Policy["level"] | null;
    const level = sharedLevel ?? storedLevel;
    if (level) setPolicy((current) => ({ ...current, level }));
    if (sharedTitle) void openArticle((params.get("lang") as Lang) ?? "en", sharedTitle);
  }, [openArticle]);

  useEffect(() => {
    window.localStorage.setItem("unspoiled.level", policy.level);
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
              registration.api === "unavailable" ? "bg-zinc-100 text-zinc-500" : "bg-emerald-50 text-emerald-700"
            }`}
          >
            {registration.api === "unavailable"
              ? "No agent connected — reading on your own"
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
              onKeyDown={(event) => event.key === "Enter" && void search()}
              placeholder="Search Wikipedia for a film, series or novel"
              className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
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
                  onClick={() => setPolicy((current) => ({ ...current, level: option.level }))}
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
            {policy.notes && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Your agent said: {policy.notes}
              </p>
            )}
          </section>

          {scanned.length > 0 && (
            <section>
              <h3 className="font-semibold">Your agent has read</h3>
              <p className="mt-1 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-900">
                {scanned
                  .map((id) => article?.sections.find((section) => section.id === id)?.heading ?? id)
                  .join(", ")}
                . It knows those spoilers for the rest of this conversation.
              </p>
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
                    <span className="block text-zinc-500">
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
  const groups = section.paragraphs.map((paragraph) => groupSentences(paragraph, section, policy));
  const allHidden = groups.every((group) => group.every((run) => run.hidden));

  if (allHidden) {
    const ids = groups.flatMap((group) => group.flatMap((run) => run.sentences.map((sentence) => sentence.id)));
    return (
      <section className="mt-6">
        <SectionHeading section={section} risk={risk} />
        <div className="mt-3 rounded-lg border border-dashed border-zinc-300 bg-white px-4 py-4">
          <p className="text-sm text-zinc-600">
            {ids.length} sentences withheld — {risk.reason}.
          </p>
          <button
            onClick={() => onReveal(ids)}
            className="mt-2 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50"
          >
            Reveal this section anyway
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-6">
      <SectionHeading section={section} risk={risk} />
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

function SectionHeading({ section, risk }: { section: Section; risk: { level: string } }) {
  return (
    <h3 className="flex items-baseline gap-2 border-b border-zinc-200 pb-1 text-lg font-semibold">
      {sectionHeading(section)}
      {risk.level !== "safe" && (
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600">{risk.level}</span>
      )}
    </h3>
  );
}

type SentenceRun = {
  key: string;
  hidden: boolean;
  reason: string;
  sentences: { id: string; text: string }[];
};

function groupSentences(paragraph: Paragraph, section: Section, policy: Policy): SentenceRun[] {
  const runs: SentenceRun[] = [];
  for (const sentence of paragraph.sentences) {
    const assessment = assessSentence(sentence, section);
    const hidden = isHidden(assessment, policy, sentence.id);
    const last = runs[runs.length - 1];
    if (last && last.hidden === hidden) {
      last.sentences.push(sentence);
      continue;
    }
    runs.push({ key: sentence.id, hidden, reason: assessment.reason, sentences: [sentence] });
  }
  return runs;
}
