import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db, hasDb } from "@/lib/db";
import { generateJson, geminiModel, groqModel, listGeminiModels } from "@/lib/llm";
import { googleNews, jinaRead, tavilySearch } from "@/lib/research";
import { mailbox } from "@/lib/gmail";
import { calendar, kushalCalendarId, adityaCalendarId } from "@/lib/calendar";
import { audit } from "@/lib/audit";

export const maxDuration = 60;

type Result = { ok: boolean; mode?: string; detail: unknown };

const Ping = z.object({ reply: z.string(), fund_city: z.string().nullable() });

const services: Record<string, () => Promise<Result>> = {
  async db() {
    if (!hasDb()) return { ok: false, detail: "DATABASE_URL not set" };
    const r = await db().execute(sql`select now() as now, current_database() as db, (select count(*) from information_schema.tables where table_schema='public') as tables`);
    return { ok: true, mode: "neon", detail: r.rows[0] };
  },
  async gemini() {
    const r = await generateJson({
      task: "ping",
      provider: "gemini",
      schema: Ping,
      prompt: 'Reply with {"reply":"pong","fund_city":null}. Set fund_city to null because you have no source.',
      bypassCache: true,
    });
    let models: string[] = [];
    try {
      models = await listGeminiModels();
    } catch {}
    return { ok: true, mode: r.model, detail: { output: r.data, attempts: r.attempts, flashModelsVisibleToKey: models } };
  },
  async groq() {
    const r = await generateJson({ task: "ping", provider: "groq", schema: Ping, prompt: 'Reply with {"reply":"pong","fund_city":null}.', bypassCache: true });
    return { ok: true, mode: groqModel(), detail: r.data };
  },
  async tavily() {
    const hits = await tavilySearch("All In Capital pre-seed fund India", undefined, { maxResults: 3 });
    return { ok: true, mode: "tavily", detail: hits.map((h) => ({ title: h.title, url: h.url })) };
  },
  async rss() {
    const hits = await googleNews("All In Capital Kushal Bhagia", undefined, 5);
    return { ok: true, mode: "google-news-rss", detail: hits.map((h) => ({ title: h.title, url: h.url, published: h.published })) };
  },
  async jina() {
    const r = await jinaRead("https://example.com/");
    return "error" in r ? { ok: false, detail: r } : { ok: true, mode: "jina", detail: { title: r.title, chars: r.text.length, head: r.text.slice(0, 200) } };
  },
  async gmail() {
    const mb = mailbox();
    const labels = await mb.listLabels();
    return { ok: true, mode: mb.mode, detail: { labels: labels.slice(0, 20), count: labels.length } };
  },
  async calendar() {
    const cal = calendar();
    const now = new Date();
    const aditya = adityaCalendarId();
    const ids = [kushalCalendarId(), ...(aditya ? [aditya] : [])];
    const fb = await cal.freeBusy(ids, now, new Date(now.getTime() + 14 * 86400_000));
    const detail: Record<string, unknown> = Object.fromEntries(Object.entries(fb).map(([k, v]) => [k, { busyBlocks: v.length, first: v[0] ?? null }]));
    if (!aditya) detail.aditya = "ADITYA_CALENDAR_ID not set: deeptech routing can't check Aditya yet";
    return { ok: true, mode: cal.mode, detail };
  },
};

export async function GET(_req: NextRequest, ctx: { params: Promise<{ service: string }> }) {
  const { service } = await ctx.params;
  const fn = services[service];
  if (!fn) return Response.json({ ok: false, detail: `unknown service; try ${Object.keys(services).join(", ")}` }, { status: 404 });
  const t0 = Date.now();
  try {
    const r = await fn();
    const ms = Date.now() - t0;
    if (hasDb()) await audit("system", `test:${service}`, { ok: r.ok, mode: r.mode, ms }).catch(() => {});
    return Response.json({ ...r, ms, geminiModel: service === "gemini" ? geminiModel() : undefined });
  } catch (e) {
    return Response.json({ ok: false, detail: (e as Error).message, ms: Date.now() - t0 }, { status: 200 });
  }
}
