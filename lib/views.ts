/** Read models for the UI (list + detail bundles). */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import {
  applications, callNotes, checks, claims, decisions, emailMessages, emailThreads, extractions, founderFiles,
  meetings, pipelineSteps, recommendations, researchReports, scores, drafts,
} from "./schema";
import { SEVERITY_RANK, type Severity } from "./rules";

const REC_ORDER: Record<string, number> = { take_call: 0, hold: 1, pass: 2 };

export async function listApplications(opts: { backtest?: boolean } = {}) {
  const apps = await db().select().from(applications).where(eq(applications.isBacktest, opts.backtest ?? false)).orderBy(applications.id);
  const ids = apps.map((a) => a.id);
  if (!ids.length) return [];
  const [recs, fl, steps, decs] = await Promise.all([
    db().select().from(recommendations).where(inArray(recommendations.applicationId, ids)).orderBy(desc(recommendations.id)),
    db().select().from(checks).where(inArray(checks.applicationId, ids)),
    db().select().from(pipelineSteps).where(inArray(pipelineSteps.applicationId, ids)),
    db().select().from(decisions).where(inArray(decisions.applicationId, ids)).orderBy(desc(decisions.id)),
  ]);
  const scoreRows = recs.length ? await db().select().from(scores).where(inArray(scores.scoreRunId, [...new Set(recs.map((r) => r.scoreRunId))])) : [];
  return apps
    .map((a) => {
      const rec = recs.find((r) => r.applicationId === a.id);
      const sc = rec ? scoreRows.filter((s) => s.scoreRunId === rec.scoreRunId) : [];
      const flags = fl
        .filter((f) => f.applicationId === a.id && f.severity !== "info")
        .sort((x, y) => SEVERITY_RANK[y.severity as Severity] - SEVERITY_RANK[x.severity as Severity]);
      const routing = fl.find((f) => f.applicationId === a.id && f.code === "deeptech_routing");
      return {
        id: a.id,
        company: a.company,
        status: a.status,
        lastError: a.lastError,
        sector: a.sector,
        businessModel: a.businessModel,
        isDeeptech: a.isDeeptech || !!routing,
        recommendation: rec?.recommendation ?? null,
        drivenBy: rec?.drivenBy ?? null,
        summary: rec?.partnerSummary ?? null,
        isWarm: rec?.isWarm ?? false,
        scores: Object.fromEntries(sc.map((s) => [s.criterion, s.score])),
        flags: flags.map((f) => ({ code: f.code, severity: f.severity, reason: f.reason })),
        steps: Object.fromEntries(steps.filter((s) => s.applicationId === a.id).map((s) => [s.step, { status: s.status, error: s.error, provider: s.provider }])),
        decision: decs.find((d) => d.applicationId === a.id) ?? null,
      };
    })
    .sort((x, y) => (REC_ORDER[x.recommendation ?? ""] ?? 3) - (REC_ORDER[y.recommendation ?? ""] ?? 3) || x.company.localeCompare(y.company));
}

export async function applicationDetail(id: number) {
  const [app] = await db().select().from(applications).where(eq(applications.id, id));
  if (!app) return null;
  const [ex] = await db().select().from(extractions).where(eq(extractions.applicationId, id)).orderBy(desc(extractions.id)).limit(1);
  const [rr] = await db().select().from(researchReports).where(eq(researchReports.applicationId, id)).orderBy(desc(researchReports.id)).limit(1);
  const [ff] = await db().select().from(founderFiles).where(eq(founderFiles.applicationId, id)).orderBy(desc(founderFiles.version)).limit(1);
  const recs = await db().select().from(recommendations).where(eq(recommendations.applicationId, id)).orderBy(desc(recommendations.id)).limit(2);
  const rec = recs[0];
  const sc = rec ? await db().select().from(scores).where(and(eq(scores.applicationId, id), eq(scores.scoreRunId, rec.scoreRunId))) : [];
  const prevSc = recs[1] ? await db().select().from(scores).where(and(eq(scores.applicationId, id), eq(scores.scoreRunId, recs[1].scoreRunId))) : [];
  const [fl, cl, st, decs, notes, threads, mtgs, drs] = await Promise.all([
    db().select().from(checks).where(eq(checks.applicationId, id)),
    db().select().from(claims).where(eq(claims.applicationId, id)).orderBy(claims.id),
    db().select().from(pipelineSteps).where(eq(pipelineSteps.applicationId, id)),
    db().select().from(decisions).where(eq(decisions.applicationId, id)).orderBy(desc(decisions.id)),
    db().select().from(callNotes).where(eq(callNotes.applicationId, id)).orderBy(desc(callNotes.id)),
    db().select().from(emailThreads).where(eq(emailThreads.applicationId, id)),
    db().select().from(meetings).where(eq(meetings.applicationId, id)),
    db().select().from(drafts).where(eq(drafts.applicationId, id)).orderBy(desc(drafts.id)),
  ]);
  const msgs = threads.length ? await db().select().from(emailMessages).where(inArray(emailMessages.threadId, threads.map((t) => t.id))).orderBy(emailMessages.id) : [];
  return {
    app,
    extraction: ex ?? null,
    research: rr ?? null,
    founderFile: ff ?? null,
    recommendation: rec ?? null,
    previousRecommendation: recs[1] ?? null,
    scores: sc,
    previousScores: prevSc,
    flags: fl.sort((x, y) => SEVERITY_RANK[y.severity as Severity] - SEVERITY_RANK[x.severity as Severity]),
    claims: cl,
    steps: st,
    decisions: decs,
    callNotes: notes,
    threads,
    messages: msgs,
    meetings: mtgs,
    drafts: drs,
  };
}
