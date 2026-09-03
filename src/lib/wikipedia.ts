export type Lang = "en" | "ja";

export type FetchedArticle = {
  lang: Lang;
  title: string;
  displayTitle: string;
  sourceUrl: string;
  html: string;
};

export type SearchHit = {
  title: string;
  snippet: string;
};

const endpoint = (lang: Lang) => `https://${lang}.wikipedia.org/w/api.php`;

async function callApi<T>(lang: Lang, params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams({ format: "json", origin: "*", ...params });
  const response = await fetch(`${endpoint(lang)}?${query}`);
  if (!response.ok) {
    throw new Error(`Wikipedia API returned ${response.status}`);
  }
  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.info ?? "Wikipedia API error");
  }
  return payload as T;
}

export async function searchArticles(lang: Lang, term: string): Promise<SearchHit[]> {
  type Response = { query: { search: { title: string; snippet: string }[] } };
  const payload = await callApi<Response>(lang, {
    action: "query",
    list: "search",
    srsearch: term,
    srlimit: "8",
  });
  return payload.query.search.map((hit) => ({
    title: hit.title,
    snippet: hit.snippet.replace(/<[^>]+>/g, ""),
  }));
}

export async function fetchArticle(lang: Lang, title: string): Promise<FetchedArticle> {
  type Response = {
    parse: {
      title: string;
      displaytitle: string;
      text: { "*": string };
    };
  };
  const payload = await callApi<Response>(lang, {
    action: "parse",
    page: title,
    prop: "text|displaytitle",
    redirects: "1",
    disableeditsection: "1",
    disabletoc: "1",
  });
  const parsed = payload.parse;
  return {
    lang,
    title: parsed.title,
    displayTitle: parsed.displaytitle.replace(/<[^>]+>/g, ""),
    sourceUrl: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(parsed.title.replace(/ /g, "_"))}`,
    html: parsed.text["*"],
  };
}
