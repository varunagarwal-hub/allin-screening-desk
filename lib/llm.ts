/**
 * Single LLM wrapper. Gemini (AI Studio free tier) first, Groq as fallback.
 * Every call returns Zod-validated JSON: try → on invalid JSON retry once with the
 * validation error → if still invalid, throw LlmStepError (caller marks the step failed).
 * Every call is cached in the DB by input hash.
 */
import { GoogleGenAI } from "@google/genai";
import Groq from "groq-sdk";
import { z } from "zod";
import { cached, sha256 } from "./cache";

export type PdfInput = { name: string; data: Buffer; /** plain-text fallback for Groq (no native PDF) */ text?: string };

export type GenerateJsonOpts<S extends z.ZodType> = {
  schema: S;
  prompt: string;
  system?: string;
  pdfs?: PdfInput[];
  temperature?: number;
  /** namespace label for cache + logs, e.g. "extract", "score" */
  task: string;
  bypassCache?: boolean;
  /** force a provider (tests) */
  provider?: "gemini" | "groq";
  /** "main" (default) for reasoning-heavy steps, "lite" for high-volume classification */
  tier?: "main" | "lite";
};

export type LlmResult<T> = { data: T; provider: "gemini" | "groq"; model: string; cached: boolean; attempts: number };

type Route = { provider: "gemini" | "groq"; model: string };

export class LlmStepError extends Error {
  constructor(
    message: string,
    public readonly task: string,
    public readonly attempts: number,
    public readonly lastRaw?: string,
  ) {
    super(message);
    this.name = "LlmStepError";
  }
}

/** Main model: PDF extraction, founder file, scoring (quality matters, low volume). */
export const geminiModel = () => process.env.GEMINI_MODEL || "gemini-3.8-flash";
/** Lite model: high-volume classification (claim checks, reply intents, edit types) and quota fallback. */
export const geminiLiteModel = () => process.env.GEMINI_MODEL_LITE || "gemini-3.5-flash-lite";
export const groqModel = () => process.env.GROQ_MODEL || "openai/gpt-oss-120b";
export const embedModel = () => process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001";

let _gemini: GoogleGenAI | null = null;
function gemini() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");
  return (_gemini ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));
}
let _groq: Groq | null = null;
function groq() {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY missing");
  return (_groq ??= new Groq({ apiKey: process.env.GROQ_API_KEY }));
}

function schemaText(schema: z.ZodType) {
  try {
    return JSON.stringify(z.toJSONSchema(schema));
  } catch {
    return "(see instructions)";
  }
}

/** Strip ```json fences / leading prose and parse. */
export function parseLooseJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : raw).trim();
  try {
    return JSON.parse(body);
  } catch {
    const start = body.search(/[[{]/);
    const end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
    if (start >= 0 && end > start) return JSON.parse(body.slice(start, end + 1));
    throw new Error("no JSON found in model output");
  }
}

async function callGemini(o: { model: string; system?: string; text: string; pdfs?: PdfInput[]; temperature: number }) {
  const parts: Array<Record<string, unknown>> = [];
  for (const p of o.pdfs ?? []) {
    parts.push({ text: `--- Attached file: ${p.name} ---` });
    parts.push({ inlineData: { mimeType: "application/pdf", data: p.data.toString("base64") } });
  }
  parts.push({ text: o.text });
  const res = await gemini().models.generateContent({
    model: o.model,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: o.system,
      responseMimeType: "application/json",
      temperature: o.temperature,
    },
  });
  return res.text ?? "";
}

async function callGroq(o: { model: string; system?: string; text: string; pdfs?: PdfInput[]; temperature: number }) {
  const pdfText = (o.pdfs ?? [])
    .map((p) => {
      if (!p.text) throw new Error(`Groq fallback cannot read PDF ${p.name} natively and no text fallback was given`);
      return `--- File: ${p.name} (extracted text) ---\n${p.text}`;
    })
    .join("\n\n");
  const res = await groq().chat.completions.create({
    model: o.model,
    temperature: o.temperature,
    response_format: { type: "json_object" },
    messages: [
      ...(o.system ? [{ role: "system" as const, content: o.system }] : []),
      { role: "user" as const, content: [pdfText, o.text].filter(Boolean).join("\n\n") },
    ],
  });
  return res.choices[0]?.message?.content ?? "";
}

function isRetryableProviderError(e: unknown) {
  const msg = String((e as Error)?.message ?? e);
  return /429|RESOURCE_EXHAUSTED|quota|rate|500|502|503|504|UNAVAILABLE|overloaded|404|NOT_FOUND|no longer available|GEMINI_API_KEY missing|fetch failed/i.test(msg);
}

async function runWithValidation<S extends z.ZodType>(
  route: Route,
  o: GenerateJsonOpts<S>,
): Promise<{ data: z.infer<S>; attempts: number }> {
  const call = route.provider === "gemini" ? callGemini : callGroq;
  const base =
    `${o.prompt}\n\nReturn ONLY JSON matching this JSON Schema. Do not invent facts or sources; use null when unknown.\n${schemaText(o.schema)}`;
  let text = base;
  let lastRaw = "";
  let lastErr = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    lastRaw = await call({ model: route.model, system: o.system, text, pdfs: o.pdfs, temperature: o.temperature ?? 0.2 });
    try {
      const parsed = o.schema.safeParse(parseLooseJson(lastRaw));
      if (parsed.success) return { data: parsed.data, attempts: attempt };
      lastErr = z.prettifyError(parsed.error);
    } catch (e) {
      lastErr = (e as Error).message;
    }
    text = `${base}\n\nYour previous output was invalid:\n${lastErr.slice(0, 1500)}\nReturn corrected JSON only.`;
  }
  throw new LlmStepError(`${o.task}: output failed validation after retry — ${lastErr.slice(0, 300)}`, o.task, 2, lastRaw);
}

/** Main entry point: Zod-validated JSON from Gemini (or Groq fallback), cached by input hash. */
export async function generateJson<S extends z.ZodType>(o: GenerateJsonOpts<S>): Promise<LlmResult<z.infer<S>>> {
  const cacheInput = {
    task: o.task,
    system: o.system,
    prompt: o.prompt,
    pdfs: (o.pdfs ?? []).map((p) => sha256(p.data)),
    schema: schemaText(o.schema),
    temperature: o.temperature ?? 0.2,
    tier: o.tier ?? "main",
    gm: o.tier === "lite" ? geminiLiteModel() : geminiModel(),
    provider: o.provider,
  };

  const { value, cached: wasCached } = await cached(
    `llm:${o.task}`,
    cacheInput,
    async () => {
      // main: Gemini main → Gemini lite (on quota/outage) → Groq.  lite: Gemini lite → Groq.
      const geminiRoutes: Route[] = (o.tier === "lite" ? [geminiLiteModel()] : [geminiModel(), geminiLiteModel()]).map((model) => ({ provider: "gemini" as const, model }));
      const groqRoute: Route = { provider: "groq", model: groqModel() };
      const order: Route[] =
        o.provider === "groq" ? [groqRoute]
        : o.provider === "gemini" ? geminiRoutes.slice(0, 1)
        : [...(process.env.GEMINI_API_KEY ? geminiRoutes : []), ...(process.env.GROQ_API_KEY ? [groqRoute] : [])];
      if (!order.length) throw new Error("No LLM configured: set GEMINI_API_KEY or GROQ_API_KEY");
      let lastErr: unknown;
      for (const route of order) {
        try {
          let r;
          try {
            r = await runWithValidation(route, o);
          } catch (e) {
            // Per-minute rate limit on Gemini: wait once (honouring retryDelay when given) before falling through.
            const msg = String((e as Error)?.message ?? e);
            if (route.provider !== "gemini" || !/429|RESOURCE_EXHAUSTED/i.test(msg) || /per day|PerDay/i.test(msg)) throw e;
            const secs = Math.min(40, Number(msg.match(/retry(?:Delay)?["\s:]*"?(\d+)/i)?.[1] ?? 20));
            await new Promise((res) => setTimeout(res, secs * 1000));
            r = await runWithValidation(route, o);
          }
          return { data: r.data, provider: route.provider, model: route.model, attempts: r.attempts };
        } catch (e) {
          lastErr = e;
          // Validation failures are final (spec: retry once, then fail visibly). Quota/outages fall through.
          if (e instanceof LlmStepError) throw e;
          if (!isRetryableProviderError(e)) break;
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    },
    { bypass: o.bypassCache },
  );
  // Re-validate cached values in case the schema changed
  const data = o.schema.parse(value.data);
  return { ...value, data, cached: wasCached };
}

/** Text embedding (Gemini). Cached. Returns null if no key so callers can degrade to keyword-only. */
export async function embed(text: string): Promise<number[] | null> {
  if (!process.env.GEMINI_API_KEY) return null;
  const { value } = await cached("embed", { m: embedModel(), text }, async () => {
    const res = await gemini().models.embedContent({ model: embedModel(), contents: text });
    return res.embeddings?.[0]?.values ?? [];
  });
  return value.length ? value : null;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** For the /test page: models this key can call (helps pick a free-tier Flash model). */
export async function listGeminiModels(): Promise<string[]> {
  const out: string[] = [];
  const pager = await gemini().models.list();
  for await (const m of pager) {
    if (m.name && /flash/i.test(m.name)) out.push(m.name.replace(/^models\//, ""));
  }
  return out;
}
