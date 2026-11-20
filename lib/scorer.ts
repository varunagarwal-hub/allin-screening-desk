/**
 * Phase 6: scores the 7 criteria with evidence, gaps, thesis basis and memory influence; recommends
 * take_call | hold | pass. The recommendation is ADVICE: nothing is decided until Kushal acts (rule 9).
 * Traceability is enforced in code: unknown claim ids are stripped, and memory refs must exist.
 */
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "./db";
import { applications, checks, claims, founderFiles, recommendations, researchReports, scores } from "./schema";
import { generateJson } from "./llm";
import { loadPrompt } from "./prompts";
import { registerStep, latestExtraction } from "./pipeline";
import { thesis, CRITERIA_KEYS, revealedFor, driftNoteFor } from "./thesis";
import { memoAsExample, similarMemos } from "./memos";
import { approvedCalibration, retrieveMemory } from "./memory";
import { memos } from "./memos";
import { businessTypes } from "./rules";
import { appSettings } from "./schema";

/** Options for scoring a backtest pseudo-application (leave-one-out + cold/warm memory switch). */
export async function backtestOpts(company: string) {
  const m = memos.find((x) => x.company === company);
  const [s] = await db().select().from(appSettings).where(eq(appSettings.key, "backtest_use_memory"));
  return { holdOut: company, excludeMemoId: m?.id, useMemory: s ? Boolean(s.value) : false };
}

const CriterionKey = z.enum(CRITERIA_KEYS as [string, ...string[]]);

export const ScoreOut = z.object({
  criteria: z.array(
    z.object({
      key: CriterionKey,
      score: z.number().int().min(1).max(5),
      confidence: z.number().min(0).max(1),
      thesis_basis: z.enum(["written", "revealed", "both"]),
      rationale: z.string(),
      evidence: z.array(z.object({ claim_id: z.number().int().nullable(), ref: z.string(), note: z.string() })),
      missing: z.array(z.object({ item: z.string(), penalty: z.number().min(0).max(2) })),
      memory_influence: z.array(z.object({ ref: z.string(), effect: z.string() })),
    }),
  ),
  recommendation: z.enum(["take_call", "hold", "pass"]),
  driven_by: z.enum(["written", "revealed"]),
  driven_by_why: z.string(),
  partner_summary: z.string(),
  what_would_change: z.string(),
  structure_not_people: z.boolean(),
  call_questions: z.array(z.string()).min(1).max(6),
});
export type ScoreOutT = z.infer<typeof ScoreOut>;

/** Enforce: exactly the 7 criteria; claim ids exist; memory refs exist. Returns cleaned output + notes. */
export function enforceTraceability(out: ScoreOutT, validClaimIds: Set<number>, validMemoryRefs: Set<string>) {
  const notes: string[] = [];
  const byKey = new Map(out.criteria.map((c) => [c.key, c]));
  const missingKeys = CRITERIA_KEYS.filter((k) => !byKey.has(k));
  if (missingKeys.length) throw new Error(`scorer omitted criteria: ${missingKeys.join(", ")}`);
  const criteria = CRITERIA_KEYS.map((k) => {
    const c = byKey.get(k)!;
    const evidence = c.evidence.map((e) => {
      if (e.claim_id != null && !validClaimIds.has(e.claim_id)) {
        notes.push(`${k}: removed unknown claim id ${e.claim_id}`);
        return { ...e, claim_id: null, note: `${e.note} (cited claim id did not exist; reference removed)` };
      }
      return e;
    });
    const memory_influence = c.memory_influence.filter((m) => {
      const ok = validMemoryRefs.has(m.ref.trim().toUpperCase());
      if (!ok) notes.push(`${k}: dropped memory ref ${m.ref} that was not in context`);
      return ok;
    });
    return { ...c, evidence, memory_influence };
  });
  return { out: { ...out, criteria }, notes };
}

export async function scoreApplication(appId: number, opts: { bypassCache?: boolean; excludeMemoId?: string; useMemory?: boolean; holdOut?: string; dryRun?: boolean } = {}) {
  const useMemory = opts.useMemory ?? true;
  const [app] = await db().select().from(applications).where(eq(applications.id, appId));
  const x = await latestExtraction(appId);
  if (!app || !x) throw new Error("run extract first");
  const flags = await db().select().from(checks).where(eq(checks.applicationId, appId));
  const cl = await db().select().from(claims).where(eq(claims.applicationId, appId));
  const [ff] = await db().select().from(founderFiles).where(eq(founderFiles.applicationId, appId)).orderBy(desc(founderFiles.version)).limit(1);
  const [rr] = await db().select().from(researchReports).where(eq(researchReports.applicationId, appId)).orderBy(desc(researchReports.id)).limit(1);
  const profile = { sector: app.sector ?? x.likely_sector.normalised, businessModel: app.businessModel ?? x.likely_sector.business_model };
  const sim = await similarMemos({ ...profile, text: x.one_liner.value ?? "" }, 3, opts.excludeMemoId);
  const mem = useMemory ? await retrieveMemory({ appId, ...profile, stage: "pre-seed", text: x.one_liner.value ?? "", bizTypes: businessTypes(x) }) : [];
  const cal = useMemory ? await approvedCalibration(profile) : [];

  const vars = {
    written: JSON.stringify({ summary: thesis.written_thesis.summary, sectors: thesis.written_thesis.sectors.value, stage: (thesis.written_thesis as Record<string, { value: unknown }>).stage?.value, cheque: (thesis.written_thesis as Record<string, { value: unknown }>).cheque?.value, founder_criteria: (thesis.written_thesis as Record<string, { value: unknown }>).founder_criteria?.value }, null, 1),
    revealed: revealedFor(opts.holdOut).map((r) => `${r.id}: ${r.pattern} [${r.evidence.map((e) => e.memo).join("; ")}]`).join("\n"),
    drift: driftNoteFor(opts.holdOut),
    criteria: thesis.criteria.map((c) => `- ${c.key} (${c.name}): ${c.definition}\n  anchors: ${Object.entries(c.anchors).map(([k, v]) => `${k}=${v}`).join(" | ")}`).join("\n"),
    memos: sim.map(memoAsExample).join("\n\n"),
    memory: mem.length ? mem.map((m) => `M${m.id} [${m.businessModel}/${m.sector}; types ${m.bizTypes.join(",") || "-"}; criteria ${m.criteria.join(",") || "none"}${m.isAgreement ? "; agreement" : ""}]: ${m.lesson}`).join("\n") : "(none)",
    calibration: cal.length ? cal.map((c) => `C${c.id}: ${c.note} (pattern: ${c.pattern})`).join("\n") : "(none)",
    extraction: JSON.stringify(x, null, 0).slice(0, 14000),
    flags: flags.map((f) => `[${f.severity}] ${f.code}: ${f.reason}`).join("\n") || "(none)",
    claims: cl.map((c) => `#${c.id} [${c.status}${c.sourceTier ? `, tier ${c.sourceTier}` : ""}] (${c.category}, ${c.claimOrigin}) ${c.text}${c.sourceUrl ? ` <${c.sourceUrl}>` : ""}`).join("\n") || "(research not run)",
    could_not_find: JSON.stringify((rr?.report as { could_not_find?: string[] } | undefined)?.could_not_find ?? ["research not run"]),
    founder: ff
      ? JSON.stringify({ signals: ff.signals, founder_market_fit: ff.founderMarketFit, red_flags: ff.redFlags, confidence: ff.confidence, call_questions: ff.callQuestions, team: (ff.calibrationMemos as { team_facts?: unknown; public_trace?: string })?.team_facts, public_trace: (ff.calibrationMemos as { public_trace?: string })?.public_trace })
      : "(founder file not built)",
  };
  const r = await generateJson({ task: "score", schema: ScoreOut, prompt: await loadPrompt("score", vars), temperature: 0.1, bypassCache: opts.bypassCache });
  const validRefs = new Set([...mem.map((m) => `M${m.id}`), ...cal.map((c) => `C${c.id}`)]);
  const { out, notes } = enforceTraceability(r.data, new Set(cl.map((c) => c.id)), validRefs);

  if (opts.dryRun) return { out, rec: null, provider: `${r.provider}:${r.model}`, memoryCount: mem.length };
  const scoreRunId = randomUUID();
  await db().insert(scores).values(
    out.criteria.map((c) => ({
      applicationId: appId,
      scoreRunId,
      criterion: c.key,
      score: c.score,
      confidence: c.confidence,
      thesisBasis: c.thesis_basis,
      evidence: [{ rationale: c.rationale }, ...c.evidence],
      missing: c.missing,
      memoryInfluence: c.memory_influence.length ? c.memory_influence : null,
    })),
  );
  const [rec] = await db()
    .insert(recommendations)
    .values({
      applicationId: appId,
      scoreRunId,
      recommendation: out.recommendation,
      drivenBy: out.driven_by,
      drivenByWhy: out.driven_by_why,
      partnerSummary: out.partner_summary,
      whatWouldChange: out.what_would_change,
      callQuestions: out.call_questions,
      fewShotMemos: sim.map((m) => ({ company: m.company, decision: m.decision, similarity: m.similarity })),
      memoryUsed: { memory: mem.map((m) => ({ ref: `M${m.id}`, lesson: m.lesson, company: m.company })), calibration: cal.map((c) => ({ ref: `C${c.id}`, note: c.note })), traceability_notes: notes, structure_not_people: out.structure_not_people, model: r.model },
      isWarm: mem.length > 0 || cal.length > 0,
    })
    .returning();
  return { out, rec, provider: `${r.provider}:${r.model}${r.cached ? " (cached)" : ""}`, memoryCount: mem.length };
}

registerStep("score", async (appId, opts) => {
  const [app] = await db().select().from(applications).where(eq(applications.id, appId));
  // backtest pseudo-applications: leave-one-out (own memo never a few-shot example or revealed-thesis evidence)
  const bt = app?.isBacktest ? await backtestOpts(app.company) : {};
  const r = await scoreApplication(appId, { ...opts, ...bt });
  return { provider: r.provider, summary: { rec: r.out.recommendation, scores: Object.fromEntries(r.out.criteria.map((c) => [c.key, c.score])), memory: r.memoryCount } };
});
