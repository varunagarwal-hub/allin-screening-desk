/**
 * Research clients: Tavily (budgeted), Google News RSS (unlimited), Jina Reader (page text).
 * Every response is cached by input hash. Every URL actually retrieved in a run is recorded in
 * `retrieved_sources` so later steps can only cite what this run really fetched.
 * Never fetches LinkedIn pages (snippets from search results only). Respects robots.txt for Jina fetches.
 */
import { XMLParser } from "fast-xml-parser";
import { randomUUID } from "node:crypto";
import { cached } from "./cache";
import { db, hasDb } from "./db";
import { retrievedSources } from "./schema";

export type SearchHit = { url: string; title: string; snippet: string; published?: string; via: "tavily" | "rss" };
export type PageText = { url: string; title?: string; text: string; via: "jina" };

const UA = "AllInScreeningDesk/0.1 (research bot; respects robots.txt)";
const BLOCKED_FETCH_HOSTS = [/(^|\.)linkedin\.com$/i];

export const TAVILY_CAP_PER_APP = 8;

/** Tracks one research run: Tavily budget + retrieved-source log. */
export class ResearchRun {
  readonly runId: string;
  tavilyCalls = 0;
  constructor(
    public readonly applicationId: number | null,
    public readonly tavilyCap = TAVILY_CAP_PER_APP,
    runId?: string,
  ) {
    this.runId = runId ?? randomUUID();
  }
  async record(url: string, via: "tavily" | "rss" | "jina", title?: string, snippet?: string) {
    if (!hasDb()) return;
    await db()
      .insert(retrievedSources)
      .values({ runId: this.runId, applicationId: this.applicationId, url, via, title, snippet: snippet?.slice(0, 2000) });
  }
}

// ---------------- Tavily ----------------
export async function tavilySearch(
  query: string,
  run?: ResearchRun,
  opts: { maxResults?: number; topic?: "general" | "news"; days?: number } = {},
): Promise<SearchHit[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error("TAVILY_API_KEY missing");
  const input = { query, maxResults: opts.maxResults ?? 5, topic: opts.topic ?? "general", days: opts.days };
  // Budget counts only real (uncached) calls against the free tier
  const { value, cached: wasCached } = await cached("tavily", input, async () => {
    if (run && run.tavilyCalls >= run.tavilyCap) throw new Error(`Tavily cap of ${run.tavilyCap} reached for this application`);
    if (run) run.tavilyCalls++;
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        query,
        max_results: input.maxResults,
        topic: input.topic,
        ...(input.days ? { days: input.days } : {}),
        search_depth: "basic",
        include_answer: false, // we never use a synthesised answer as a source
      }),
    });
    if (!res.ok) throw new Error(`Tavily ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { results?: Array<{ url: string; title: string; content: string; published_date?: string }> };
    return (j.results ?? []).map<SearchHit>((r) => ({
      url: r.url,
      title: r.title,
      snippet: r.content,
      published: r.published_date,
      via: "tavily",
    }));
  });
  void wasCached;
  if (run) for (const h of value) await run.record(h.url, "tavily", h.title, h.snippet);
  return value;
}

// ---------------- Google News RSS ----------------
const xml = new XMLParser({ ignoreAttributes: false });

export function googleNewsUrl(query: string) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
}

export function parseRss(body: string): SearchHit[] {
  const doc = xml.parse(body);
  const items = doc?.rss?.channel?.item;
  const arr = Array.isArray(items) ? items : items ? [items] : [];
  return arr.map((it: Record<string, unknown>) => ({
    url: String(it.link ?? ""),
    title: String(it.title ?? ""),
    snippet: String(typeof it.source === "object" ? ((it.source as Record<string, string>)["#text"] ?? "") : (it.source ?? "")),
    published: it.pubDate ? String(it.pubDate) : undefined,
    via: "rss" as const,
  }));
}

export async function googleNews(query: string, run?: ResearchRun, limit = 10): Promise<SearchHit[]> {
  const { value } = await cached("rss", { query }, async () => {
    const res = await fetch(googleNewsUrl(query), { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`Google News RSS ${res.status}`);
    return parseRss(await res.text());
  });
  const hits = value.slice(0, limit);
  if (run) for (const h of hits) await run.record(h.url, "rss", h.title, h.snippet);
  return hits;
}

// ---------------- robots.txt ----------------
/** Minimal robots.txt check for the `*` user-agent group. Exported for unit tests. */
export function robotsAllows(robotsTxt: string, path: string): boolean {
  const lines = robotsTxt.split(/\r?\n/).map((l) => l.replace(/#.*/, "").trim());
  let inStar = false;
  const rules: Array<{ allow: boolean; path: string }> = [];
  for (const l of lines) {
    const m = l.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [, k, v] = m;
    if (k.toLowerCase() === "user-agent") inStar = v.trim() === "*";
    else if (inStar && (k.toLowerCase() === "disallow" || k.toLowerCase() === "allow") && v) {
      rules.push({ allow: k.toLowerCase() === "allow", path: v.trim() });
    }
  }
  // Longest match wins
  let best: { allow: boolean; path: string } | null = null;
  for (const r of rules) if (path.startsWith(r.path) && (!best || r.path.length > best.path.length)) best = r;
  return best ? best.allow : true;
}

async function robotsOk(url: string): Promise<boolean> {
  const u = new URL(url);
  const { value } = await cached("robots", { origin: u.origin }, async () => {
    try {
      const r = await fetch(`${u.origin}/robots.txt`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
      return r.ok ? await r.text() : "";
    } catch {
      return "";
    }
  });
  return robotsAllows(value, u.pathname || "/");
}

// ---------------- Jina Reader ----------------
export async function jinaRead(url: string, run?: ResearchRun): Promise<PageText | { url: string; error: string }> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { url, error: "invalid URL" };
  }
  if (BLOCKED_FETCH_HOSTS.some((re) => re.test(u.hostname))) return { url, error: "blocked host (login-walled / not scraped)" };
  if (/\.example$/i.test(u.hostname)) return { url, error: "reserved .example domain — no public site exists" };
  if (!(await robotsOk(url))) return { url, error: "disallowed by robots.txt" };

  try {
    const { value } = await cached("jina", { url }, async () => {
      const res = await fetch(`https://r.jina.ai/${url}`, {
        headers: { "User-Agent": UA, Accept: "text/plain", "X-Return-Format": "text" },
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) throw new Error(`Jina ${res.status}`);
      const text = await res.text();
      const title = text.match(/^Title:\s*(.*)$/m)?.[1];
      return { url, title, text: text.slice(0, 20000), via: "jina" as const };
    });
    if (run) await run.record(url, "jina", value.title, value.text.slice(0, 500));
    return value;
  } catch (e) {
    return { url, error: (e as Error).message };
  }
}

// ---------------- source tiers ----------------
/** 1 regulator/company/filing, 2 reputable press, 3 blog/aggregator, 4 forum. Heuristic; LLM may refine. */
export function sourceTier(url: string, companyDomain?: string): 1 | 2 | 3 | 4 {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return 4;
  }
  if (companyDomain && host.endsWith(companyDomain.replace(/^www\./, ""))) return 1;
  if (/(\.gov\.in|\.nic\.in|rbi\.org\.in|sebi\.gov\.in|mca\.gov\.in|dgca\.gov\.in|digitalsky\.dgca|irdai\.gov\.in)$/.test(host)) return 1;
  if (/(economictimes\.indiatimes\.com|livemint\.com|business-standard\.com|thehindubusinessline\.com|moneycontrol\.com|reuters\.com|bloomberg\.com|techcrunch\.com|the-ken\.com|inc42\.com|entrackr\.com|yourstory\.com|vccircle\.com|financialexpress\.com|forbesindia\.com|thehindu\.com|hindustantimes\.com|indianexpress\.com)$/.test(host)) return 2;
  if (/(reddit\.com|quora\.com|news\.ycombinator\.com|twitter\.com|x\.com)$/.test(host)) return 4;
  return 3;
}
