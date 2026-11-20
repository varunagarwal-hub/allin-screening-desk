/**
 * Per-application pipeline. Each step is one API call (stays inside Vercel timeouts and free-tier limits),
 * records visible status in `pipeline_steps`, and never silently fails.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { applications, extractions, pipelineSteps } from "./schema";
import { audit } from "./audit";
import { extractApplication, numericConflicts, type ExtractionT } from "./extract";
import { loadFile } from "./intake";
import { LlmStepError } from "./llm";

export const STEPS = ["extract", "rules", "research", "founder", "score"] as const;
export type Step = (typeof STEPS)[number];

const STATUS_AFTER: Record<Step, typeof applications.$inferSelect.status> = {
  extract: "extracted",
  rules: "checked",
  research: "researched",
  founder: "founder_filed",
  score: "scored",
};

type StepFn = (appId: number, opts: { bypassCache?: boolean }) => Promise<{ provider?: string; summary?: unknown }>;
const registry = new Map<Step, StepFn>();
export function registerStep(step: Step, fn: StepFn) {
  registry.set(step, fn);
}

export async function runStep(appId: number, step: Step, opts: { bypassCache?: boolean } = {}) {
  const fn = registry.get(step);
  if (!fn) throw new Error(`step ${step} not implemented`);
  const now = new Date();
  await db()
    .insert(pipelineSteps)
    .values({ applicationId: appId, step, status: "running", attempts: 1, startedAt: now })
    .onConflictDoUpdate({
      target: [pipelineSteps.applicationId, pipelineSteps.step],
      set: { status: "running", startedAt: now, finishedAt: null, error: null },
    });
  try {
    const r = await fn(appId, opts);
    await db()
      .update(pipelineSteps)
      .set({ status: "ok", finishedAt: new Date(), provider: r.provider ?? null })
      .where(and(eq(pipelineSteps.applicationId, appId), eq(pipelineSteps.step, step)));
    await db().update(applications).set({ status: STATUS_AFTER[step], lastError: null, updatedAt: new Date() }).where(eq(applications.id, appId));
    await audit("system", `step:${step}:ok`, { provider: r.provider }, appId);
    return { ok: true as const, ...r };
  } catch (e) {
    const msg = e instanceof LlmStepError ? e.message : (e as Error).message;
    await db()
      .update(pipelineSteps)
      .set({ status: "failed", finishedAt: new Date(), error: msg.slice(0, 2000) })
      .where(and(eq(pipelineSteps.applicationId, appId), eq(pipelineSteps.step, step)));
    await db().update(applications).set({ status: "failed", lastError: `${step}: ${msg}`.slice(0, 2000), updatedAt: new Date() }).where(eq(applications.id, appId));
    await audit("system", `step:${step}:failed`, { error: msg.slice(0, 500) }, appId);
    return { ok: false as const, error: msg };
  }
}

export async function latestExtraction(appId: number): Promise<ExtractionT | null> {
  const [row] = await db().select().from(extractions).where(eq(extractions.applicationId, appId)).orderBy(desc(extractions.id)).limit(1);
  return (row?.data as ExtractionT) ?? null;
}

// ---------------- extract ----------------
registerStep("extract", async (appId, opts) => {
  const [app] = await db().select().from(applications).where(eq(applications.id, appId));
  if (!app) throw new Error("application not found");
  const form = await loadFile(app.formFileId);
  const deck = await loadFile(app.deckFileId);
  if (!form && !deck && !app.backtestText) throw new Error("no form, deck or memo text to read");
  const r = await extractApplication({ company: app.company, form, deck, memoText: app.backtestText ?? undefined, bypassCache: opts.bypassCache });
  const x = r.data;
  const conflicts = [...x.form_deck_conflicts, ...numericConflicts(x)];
  await db().insert(extractions).values({
    applicationId: appId,
    data: x,
    conflicts,
    sectorMislabel: x.likely_sector.mislabel
      ? { selected: x.sector_selected.value, likely: x.likely_sector.normalised, reason: x.likely_sector.reason }
      : null,
    model: r.model,
  });
  await db()
    .update(applications)
    .set({
      sector: x.likely_sector.normalised,
      businessModel: x.likely_sector.business_model,
      isDeeptech: x.is_deeptech,
      founderEmail: x.founder_email,
    })
    .where(eq(applications.id, appId));
  return { provider: `${r.provider}:${r.model}${r.cached ? " (cached)" : ""}`, summary: { conflicts: conflicts.length, mislabel: x.likely_sector.mislabel } };
});
