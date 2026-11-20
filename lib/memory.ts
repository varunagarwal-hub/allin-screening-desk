/**
 * Loop 1: Kushal's / Riya's decisions -> decision_memory -> scorer context.
 * Retrieval = tag overlap (sector, model, stage, criteria) + embedding similarity of the one-line lesson.
 * Calibration notes are proposed by the LLM when 3+ corrections share a pattern; only APPROVED notes reach the scorer.
 */
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { applications, calibrationNotes, decisionMemory, decisions, recommendations, scores } from "./schema";
import { cosine, embed, generateJson } from "./llm";
import { loadPrompt } from "./prompts";
import { audit } from "./audit";
import { latestExtraction } from "./pipeline";
import { businessTypes } from "./rules";

export type MemoryHit = { id: number; lesson: string; sector: string | null; businessModel: string | null; stage: string | null; criteria: string[]; bizTypes: string[]; isAgreement: boolean; score: number; company?: string };

/** Pure tag-overlap score (unit-tested). */
export function memoryTagScore(
  m: { sector: string | null; businessModel: string | null; stage: string | null; bizTypes?: string[] },
  p: { sector: string | null; businessModel: string | null; stage: string | null; bizTypes?: string[] },
) {
  const sharedTypes = (m.bizTypes ?? []).filter((t) => t !== "other" && (p.bizTypes ?? []).includes(t)).length;
  return (m.businessModel && m.businessModel === p.businessModel ? 2 : 0) + (m.sector && m.sector === p.sector ? 1 : 0) + (m.stage && p.stage && m.stage === p.stage ? 0.5 : 0) + 2 * sharedTypes;
}

export async function retrieveMemory(p: { appId: number; sector: string | null; businessModel: string | null; stage: string | null; text: string; bizTypes?: string[] }, k = 5): Promise<MemoryHit[]> {
  const rows = await db()
    .select({ m: decisionMemory, appId: decisions.applicationId, company: applications.company })
    .from(decisionMemory)
    .innerJoin(decisions, eq(decisionMemory.decisionId, decisions.id))
    .innerJoin(applications, eq(decisions.applicationId, applications.id));
  const a = p.text ? await embed(p.text).catch(() => null) : null;
  const hits: MemoryHit[] = [];
  for (const r of rows) {
    if (r.appId === p.appId) continue; // a company's own correction is applied directly, not as "memory"
    const tag = memoryTagScore({ ...r.m, bizTypes: r.m.bizTypes as string[] }, p);
    const sim = a && Array.isArray(r.m.embedding) ? cosine(a, r.m.embedding as number[]) : 0;
    const score = tag + 2 * sim;
    if (tag === 0 && sim < 0.6) continue;
    hits.push({ id: r.m.id, lesson: r.m.lesson, sector: r.m.sector, businessModel: r.m.businessModel, stage: r.m.stage, criteria: r.m.criteria as string[], bizTypes: r.m.bizTypes as string[], isAgreement: r.m.isAgreement, score: Number(score.toFixed(3)), company: r.company });
  }
  return hits.sort((x, y) => y.score - x.score).slice(0, k);
}

export async function approvedCalibration(p: { sector: string | null; businessModel: string | null }) {
  const rows = await db().select().from(calibrationNotes).where(eq(calibrationNotes.status, "approved"));
  return rows.filter((n) => {
    const s = (n.scope ?? {}) as { sector?: string; businessModel?: string };
    return (!s.sector || s.sector === p.sector) && (!s.businessModel || s.businessModel === p.businessModel);
  });
}

export type DecisionInput = {
  appId: number;
  kind: "accept" | "override";
  finalCall: "take_call" | "hold" | "pass";
  criterionChanges: Array<{ criterion: string; old: number; new: number }>;
  reason?: string;
  decidedBy: string;
  source?: "review" | "call_notes";
};

/** Store a decision AND its reusable memory entry (agreements too). Rule 10: overrides need a one-line reason. */
export async function recordDecision(d: DecisionInput) {
  if (d.kind === "override" && !d.reason?.trim()) throw new Error("An override needs a one-line reason so it can be reused.");
  const [app] = await db().select().from(applications).where(eq(applications.id, d.appId));
  if (!app) throw new Error("application not found");
  const [rec] = await db().select().from(recommendations).where(eq(recommendations.applicationId, d.appId)).orderBy(desc(recommendations.id)).limit(1);
  const [dec] = await db()
    .insert(decisions)
    .values({ applicationId: d.appId, recommendationId: rec?.id, kind: d.kind, finalCall: d.finalCall, criterionChanges: d.criterionChanges, reason: d.reason ?? null, decidedBy: d.decidedBy, source: d.source ?? "review" })
    .returning();
  const isAgreement = d.kind === "accept" && !d.criterionChanges.length;
  const changed = d.criterionChanges.map((c) => `${c.criterion} ${c.old}->${c.new}`).join(", ");
  const lesson = isAgreement
    ? `Agreed with system (${d.finalCall}) on ${app.company} (${app.businessModel ?? app.sector}).${d.reason ? " " + d.reason : ""}`
    : `${app.company} (${app.businessModel ?? app.sector}): system said ${rec?.recommendation ?? "?"}, ${d.decidedBy} made it ${d.finalCall}${changed ? `; changed ${changed}` : ""}. Reason: ${d.reason}`;
  const emb = await embed(lesson).catch(() => null);
  const stage = "pre-seed";
  const x = await latestExtraction(d.appId);
  const bizTypes = x ? businessTypes(x) : [];
  await db().insert(decisionMemory).values({
    decisionId: dec.id,
    sector: app.sector,
    businessModel: app.businessModel,
    stage,
    criteria: d.criterionChanges.map((c) => c.criterion),
    bizTypes,
    isAgreement,
    lesson,
    embedding: emb,
  });
  await db().update(applications).set({ status: "decided", updatedAt: new Date() }).where(eq(applications.id, d.appId));
  await audit(d.decidedBy as "kushal", `decision:${d.kind}`, { finalCall: d.finalCall, changes: d.criterionChanges, reason: d.reason }, d.appId);
  const proposal = await maybeProposeCalibration().catch((e) => ({ error: (e as Error).message }));
  return { decision: dec, lesson, proposal };
}

const Proposal = z.object({
  patterns: z.array(
    z.object({
      pattern: z.string(),
      note: z.string(),
      scope: z.object({ sector: z.string().nullable(), businessModel: z.string().nullable(), criterion: z.string().nullable() }),
      based_on_ids: z.array(z.number().int()).min(3),
    }),
  ),
});

/** When 3+ corrections share a pattern, ask the LLM to propose a calibration note (Kushal approves/rejects). */
export async function maybeProposeCalibration() {
  const rows = await db()
    .select({ id: decisions.id, lesson: decisionMemory.lesson, criteria: decisionMemory.criteria, sector: decisionMemory.sector, model: decisionMemory.businessModel })
    .from(decisionMemory)
    .innerJoin(decisions, eq(decisionMemory.decisionId, decisions.id))
    .where(eq(decisionMemory.isAgreement, false));
  if (rows.length < 3) return { proposed: 0, reason: "fewer than 3 corrections" };
  const existing = await db().select().from(calibrationNotes);
  const used = new Set(existing.flatMap((n) => (n.basedOnDecisionIds as number[]) ?? []));
  const fresh = rows.filter((r) => !used.has(r.id));
  // cheap pre-check: need 3+ fresh corrections sharing a criterion or business model
  const counts = new Map<string, number>();
  for (const r of fresh) for (const k of [...(r.criteria as string[]).map((c) => `c:${c}`), `m:${r.model}`]) counts.set(k, (counts.get(k) ?? 0) + 1);
  if (![...counts.values()].some((n) => n >= 3)) return { proposed: 0, reason: "no shared pattern across 3+ fresh corrections" };
  const r = await generateJson({
    task: "calibration",
    tier: "lite",
    schema: Proposal,
    prompt: await loadPrompt("calibration", { corrections: fresh.map((f) => `#${f.id} [${f.model}/${f.sector}; criteria ${(f.criteria as string[]).join(",")}] ${f.lesson}`).join("\n") }),
    temperature: 0,
  });
  const validIds = new Set(fresh.map((f) => f.id));
  let n = 0;
  for (const p of r.data.patterns) {
    const ids = p.based_on_ids.filter((i) => validIds.has(i));
    if (ids.length < 3) continue;
    await db().insert(calibrationNotes).values({ pattern: p.pattern, note: p.note, scope: p.scope, basedOnDecisionIds: ids, status: "proposed" });
    n++;
  }
  return { proposed: n };
}

export async function reviewCalibration(id: number, approve: boolean, by: string) {
  await db().update(calibrationNotes).set({ status: approve ? "approved" : "rejected", reviewedBy: by, reviewedAt: new Date() }).where(eq(calibrationNotes.id, id));
  await audit(by as "kushal", `calibration:${approve ? "approved" : "rejected"}`, { id });
}

export async function latestScores(appId: number) {
  const [rec] = await db().select().from(recommendations).where(eq(recommendations.applicationId, appId)).orderBy(desc(recommendations.id)).limit(1);
  if (!rec) return null;
  const sc = await db().select().from(scores).where(and(eq(scores.applicationId, appId), eq(scores.scoreRunId, rec.scoreRunId)));
  return { rec, scores: sc };
}

export async function decisionsFor(appIds: number[]) {
  if (!appIds.length) return [];
  return db().select().from(decisions).where(inArray(decisions.applicationId, appIds)).orderBy(desc(decisions.id));
}
