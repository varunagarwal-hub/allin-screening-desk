/**
 * Phase 4: fixed-plan research per application (<= 8 Tavily calls; RSS + Jina unlimited), then a claim check.
 * Anti-fabrication is enforced in CODE, not just in the prompt: any claim citing a source that was not
 * retrieved in this run is downgraded to not_found, and excerpts must appear in the retrieved text.
 */
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { applications, claims, researchReports } from "./schema";
import { generateJson } from "./llm";
import { loadPrompt } from "./prompts";
import { ResearchRun, googleNews, jinaRead, sourceTier, tavilySearch, type SearchHit } from "./research";
import { registerStep, latestExtraction } from "./pipeline";
import type { ExtractionT } from "./extract";

const Plan = z.object({
  category_phrase: z.string(),
  competitor_query: z.string(),
  funding_query: z.string(),
  regulator: z.string(),
  regulation_query: z.string(),
  founder_queries: z.array(z.string()).max(3),
  identity_query: z.string(),
});

const Check = z.object({
  claims: z.array(
    z.object({
      text: z.string(),
      category: z.enum(["traction", "market", "partnership", "competition", "team", "identity", "regulation", "funding"]),
      origin: z.enum(["form", "deck"]),
      page: z.number().int().nullable(),
      status: z.enum(["verified", "contradicted", "unverifiable"]),
      source_id: z.string().nullable(),
      excerpt: z.string().nullable(),
      confidence: z.number().min(0).max(1),
    }),
  ),
  findings: z.array(z.object({ section: z.enum(["identity", "founders", "competitors", "funding", "regulation"]), fact: z.string(), source_id: z.string(), excerpt: z.string() })),
  competitors_found: z.array(z.object({ name: z.string(), source_id: z.string() })),
  could_not_find: z.array(z.string()),
  section_summaries: z.object({ identity: z.string(), founders: z.string(), competitors: z.string(), funding: z.string(), regulation: z.string() }),
});

export type Src = { id: string; url: string; title: string; text: string; via: string; section: string; tier: number; fetchedAt: string };

function factsFor(x: ExtractionT) {
  return JSON.stringify({
    company: x.company.value,
    legal_name: x.legal_name.value,
    city: x.city.value,
    website: x.website.value,
    one_liner: x.one_liner.value,
    sector: x.likely_sector,
    founders: x.founders.map((f) => ({ name: f.name, role: f.role, background: f.background })),
    credit_or_regulatory: x.credit_or_regulatory.map((c) => c.detail),
  });
}

function claimsFor(x: ExtractionT) {
  const lines: string[] = [];
  const p = (o: { file: string; page: number | null } | null) => (o ? `${o.file}${o.page ? ` p${o.page}` : ""}` : "?");
  lines.push(`company: ${x.company.value} (${x.legal_name.value ?? ""}), city ${x.city.value}, incorporated ${x.incorporation_date.value}, website ${x.website.value}`);
  for (const f of x.founders) lines.push(`founder [${p(f.source)}]: ${f.name}, ${f.role}: ${f.background ?? ""} ${f.prior_startups ?? ""}`);
  for (const t of x.traction_metrics) lines.push(`traction [${p(t.source)}]: ${t.metric} = ${t.value}${t.period ? ` (${t.period})` : ""}`);
  for (const c of x.competition_claims) lines.push(`competition [${p(c.source)}]: ${c.claim}`);
  for (const c of x.credit_or_regulatory) lines.push(`regulatory [${p(c.source)}]: ${c.item}: ${c.detail}`);
  for (const u of x.unit_economics) lines.push(`unit economics [${p(u.source)}]: ${u.metric} = ${u.value}`);
  return lines.join("\n");
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[^\w ₹%.,-]/g, "");
/** True if `excerpt` really appears (loosely) in `text`. Exported for tests. */
export function excerptInText(excerpt: string, text: string) {
  const e = norm(excerpt).slice(0, 120);
  if (e.length < 12) return false;
  const t = norm(text);
  if (t.includes(e)) return true;
  // allow minor punctuation drift: require 80% of 5-word shingles to appear
  const words = e.split(" ");
  const sh: string[] = [];
  for (let i = 0; i + 5 <= words.length; i++) sh.push(words.slice(i, i + 5).join(" "));
  return sh.length > 0 && sh.filter((s) => t.includes(s)).length / sh.length >= 0.8;
}

export async function runResearch(appId: number, opts: { bypassCache?: boolean } = {}) {
  const x = await latestExtraction(appId);
  if (!x) throw new Error("run extract first");
  const run = new ResearchRun(appId);
  const sources: Src[] = [];
  const errors: string[] = [];
  const add = (section: string, h: SearchHit | { url: string; title?: string; text: string; via: "jina" }) => {
    if (!h.url || sources.some((s) => s.url === h.url && s.section === section)) return;
    const text = "snippet" in h ? `${h.title}\n${h.snippet}` : h.text.slice(0, 3000);
    sources.push({ id: `S${sources.length + 1}`, url: h.url, title: h.title ?? "", text, via: h.via, section, tier: sourceTier(h.url, x.website.value?.replace(/^https?:\/\//, "").replace(/\/.*$/, "")), fetchedAt: new Date().toISOString() });
  };
  const tav = async (section: string, q: string, o: Parameters<typeof tavilySearch>[2] = {}) => {
    if (!q.trim()) return;
    try {
      for (const h of await tavilySearch(q, run, { maxResults: 5, ...o })) add(section, h);
    } catch (e) {
      errors.push(`tavily(${section}): ${(e as Error).message}`);
    }
  };
  const rss = async (section: string, q: string, n = 6) => {
    try {
      for (const h of await googleNews(q, run, n)) add(section, h);
    } catch (e) {
      errors.push(`rss(${section}): ${(e as Error).message}`);
    }
  };

  // Plan (lite model, cheap)
  const plan = (await generateJson({ task: "research_plan", tier: "lite", schema: Plan, prompt: await loadPrompt("research_plan", { facts: factsFor(x) }), temperature: 0, bypassCache: opts.bypassCache })).data;

  // 1. Identity
  const site = x.website.value ? (x.website.value.startsWith("http") ? x.website.value : `https://${x.website.value}`) : null;
  const siteNote: string[] = [];
  if (site) {
    const r = await jinaRead(site, run);
    if ("error" in r) siteNote.push(`Company website ${site}: ${r.error}`);
    else add("identity", r);
  } else siteNote.push("No website given in form or deck.");
  await tav("identity", plan.identity_query);
  await rss("identity", `"${x.company.value}"`, 5);
  // 2. Founders (LinkedIn appears only as search snippets; never fetched)
  for (const q of plan.founder_queries.slice(0, 2)) await tav("founders", q);
  // 3. Competitors
  await tav("competitors", `${plan.category_phrase} startup India`);
  await tav("competitors", plan.competitor_query);
  // 4. Funding activity in the space (last 12 months)
  await rss("funding", plan.funding_query, 8);
  await tav("funding", plan.funding_query, { topic: "news", days: 365 });
  // 5. Regulation
  if (plan.regulator.toLowerCase() !== "none" && plan.regulation_query) await tav("regulation", plan.regulation_query);

  // Claim check (main model)
  const srcText = sources.map((s) => `${s.id} [${s.section}, tier ${s.tier}, ${s.via}] ${s.url}\n${s.text.slice(0, 1200)}`).join("\n\n");
  const check = (
    await generateJson({
      task: "claim_check",
      schema: Check,
      prompt: await loadPrompt("claim_check", { claims: claimsFor(x), sources: srcText || "(no sources retrieved)" }),
      temperature: 0,
      bypassCache: opts.bypassCache,
    })
  ).data;

  // ---- anti-fabrication enforcement ----
  const byId = new Map(sources.map((s) => [s.id, s]));
  let downgraded = 0;
  const finalClaims = check.claims.map((c) => {
    const src = c.source_id ? byId.get(c.source_id) : undefined;
    if (c.status !== "unverifiable" && !src) {
      downgraded++;
      return { ...c, status: "not_found" as const, source: null, excerpt: null, confidence: Math.min(c.confidence, 0.3) };
    }
    if (src && c.excerpt && !excerptInText(c.excerpt, src.text)) {
      downgraded++;
      return { ...c, excerpt: src.text.replace(/\s+/g, " ").slice(0, 280), confidence: Math.min(c.confidence, 0.5), source: src };
    }
    return { ...c, status: c.status as "verified" | "contradicted" | "unverifiable", source: src ?? null };
  });
  const findings = check.findings.filter((f) => byId.has(f.source_id)).map((f) => ({ ...f, url: byId.get(f.source_id)!.url, tier: byId.get(f.source_id)!.tier }));
  const competitors = check.competitors_found.filter((c) => byId.has(c.source_id)).map((c) => ({ ...c, url: byId.get(c.source_id)!.url }));

  // persist
  await db().delete(claims).where(eq(claims.applicationId, appId));
  if (finalClaims.length)
    await db()
      .insert(claims)
      .values(
        finalClaims.map((c) => ({
          applicationId: appId,
          runId: run.runId,
          category: c.category,
          text: c.text,
          claimOrigin: c.origin,
          sourceUrl: c.source?.url ?? null,
          sourceFile: c.source ? null : c.origin,
          sourcePage: c.source ? null : c.page,
          excerpt: c.excerpt?.slice(0, 300) ?? null,
          sourceTier: c.source?.tier ?? null,
          fetchedAt: c.source ? new Date(c.source.fetchedAt) : null,
          status: c.status,
          confidence: c.confidence,
        })),
      );
  const report = {
    plan,
    sections: check.section_summaries,
    findings,
    competitors_found: competitors,
    could_not_find: [...siteNote, ...check.could_not_find],
    sources: sources.map(({ text, ...s }) => ({ ...s, snippet: text.slice(0, 300) })),
    errors,
    downgraded,
    tavily_calls: run.tavilyCalls,
  };
  await db().delete(researchReports).where(eq(researchReports.applicationId, appId));
  await db().insert(researchReports).values({ applicationId: appId, runId: run.runId, report, tavilyCalls: run.tavilyCalls });
  return { report, claims: finalClaims };
}

registerStep("research", async (appId, opts) => {
  const [app] = await db().select().from(applications).where(eq(applications.id, appId));
  if (app?.isBacktest) {
    // Memo companies are real: live web results would reveal the fund decision and later outcomes (leakage).
    await db().delete(researchReports).where(eq(researchReports.applicationId, appId));
    await db().insert(researchReports).values({ applicationId: appId, runId: "backtest-skip", tavilyCalls: 0, report: { plan: null, sections: {}, findings: [], competitors_found: [], could_not_find: ["Research disabled for backtest pseudo-applications to avoid outcome leakage (these are real companies whose funding news reveals the decision)."], sources: [], errors: [], downgraded: 0, tavily_calls: 0 } });
    return { provider: "skipped (backtest)", summary: { skipped: true } };
  }
  const r = await runResearch(appId, opts);
  const counts = r.claims.reduce<Record<string, number>>((a, c) => ((a[c.status] = (a[c.status] ?? 0) + 1), a), {});
  return { provider: `tavily x${r.report.tavily_calls}`, summary: { sources: r.report.sources.length, claims: counts, downgraded: r.report.downgraded } };
});
