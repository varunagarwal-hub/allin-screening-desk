/** Phase 5: founder file per application (signals present/absent/unknown with evidence). */
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db } from "./db";
import { applications, callNotes, founderFiles, researchReports } from "./schema";
import { generateJson, type PdfInput } from "./llm";
import { loadPrompt } from "./prompts";
import { registerStep, latestExtraction } from "./pipeline";
import { loadFile } from "./intake";
import { memoAsExample, memos, similarMemos } from "./memos";
import type { ExtractionT } from "./extract";

export const SIGNALS = {
  rewarded: ["owns_risk", "cohorts_margins", "field_groundwork", "names_failures", "milestone_sequence", "founder_market_fit"],
  penalised: ["pushes_risk", "defensive", "growth_bought", "regulatory_bet"],
} as const;
const ALL = [...SIGNALS.rewarded, ...SIGNALS.penalised] as const;

const Src = z.object({ type: z.enum(["form", "deck", "memo", "web", "call_notes"]), page: z.number().int().nullable(), url: z.string().nullable() }).nullable();

export const FounderFile = z.object({
  signals: z.array(
    z.object({
      signal: z.enum(ALL),
      state: z.enum(["present", "absent", "unknown", "not_applicable"]),
      evidence: z.string(),
      source: Src,
      call_only: z.boolean(),
    }),
  ),
  founder_market_fit: z.string(),
  team_facts: z.array(z.object({ fact: z.string(), flag: z.boolean(), source: Src })),
  red_flags: z.array(z.object({ flag: z.string(), source: Src })),
  confidence: z.number().min(0).max(1),
  public_trace: z.enum(["none", "thin", "some", "strong"]),
  call_questions: z.array(z.string()).min(3).max(5),
  memos_used: z.array(z.string()),
});
export type FounderFileT = z.infer<typeof FounderFile>;

export function formFacts(x: ExtractionT) {
  return JSON.stringify(
    {
      founders: x.founders,
      equity_split: x.equity_split,
      team_composition: x.team_composition,
      outsourced_or_contract_staff: x.outsourced_or_contract_staff,
      repeat_retention: x.repeat_retention,
      unit_economics: x.unit_economics,
      credit_or_regulatory: x.credit_or_regulatory,
      competition_claims: x.competition_claims,
      milestones_promised: x.milestones_promised,
      form_deck_conflicts: x.form_deck_conflicts,
      application_source: x.application_source,
    },
    null,
    1,
  );
}

/** Ensure every signal is present exactly once; anything the model skipped becomes "unknown" (never silently dropped). */
export function completeSignals(ff: FounderFileT): FounderFileT {
  const seen = new Map(ff.signals.map((s) => [s.signal, s]));
  return {
    ...ff,
    signals: ALL.map(
      (sig) =>
        seen.get(sig) ?? { signal: sig, state: "unknown" as const, evidence: "Not assessed by the model; treated as unknown.", source: null, call_only: true },
    ).map((s) => (s.state !== "unknown" && s.state !== "not_applicable" && !s.source ? { ...s, state: "unknown" as const, evidence: `${s.evidence} (no source given, so downgraded to unknown)` } : s)),
  };
}

export async function buildFounderFile(appId: number, opts: { bypassCache?: boolean; excludeMemoId?: string } = {}) {
  const [app] = await db().select().from(applications).where(eq(applications.id, appId));
  const x = await latestExtraction(appId);
  if (!app || !x) throw new Error("run extract first");
  const [rr] = await db().select().from(researchReports).where(eq(researchReports.applicationId, appId)).orderBy(desc(researchReports.id)).limit(1);
  const rep = rr?.report as { findings?: Array<{ section: string; fact: string; url: string }>; could_not_find?: string[]; sections?: Record<string, string> } | undefined;
  const research = rep
    ? JSON.stringify({ founders_summary: rep.sections?.founders, identity_summary: rep.sections?.identity, findings: rep.findings?.filter((f) => ["founders", "identity"].includes(f.section)), could_not_find: rep.could_not_find }, null, 1)
    : "(research step not run: treat public trace as unknown)";
  const notes = await db().select().from(callNotes).where(eq(callNotes.applicationId, appId)).orderBy(desc(callNotes.id));
  const notesText = notes.length ? `\n\nCALL NOTES from the partners (newest first; source type "call_notes"; these can resolve call-only signals):\n${notes.map((n) => `- ${n.author}: ${n.notes}`).join("\n")}` : "";
  const sim = await similarMemos({ sector: app.sector ?? x.likely_sector.normalised, businessModel: app.businessModel ?? x.likely_sector.business_model, text: x.one_liner.value ?? "" }, 3, opts.excludeMemoId);
  const pdfs: PdfInput[] = [];
  const form = await loadFile(app.formFileId);
  const deck = await loadFile(app.deckFileId);
  if (form) pdfs.push({ ...form, name: "FORM: " + form.name });
  if (deck) pdfs.push({ ...deck, name: "DECK: " + deck.name });
  const prompt = await loadPrompt("founder", {
    form_facts: formFacts(x),
    memo_note: app.backtestText ? `(No PDFs: this is a pseudo-application built from a stripped past memo. Text:)\n${app.backtestText}` : "",
    research,
    memos: sim.map(memoAsExample).join("\n\n"),
  });
  const r = await generateJson({ task: "founder", schema: FounderFile, prompt: prompt + notesText, pdfs, temperature: 0.1, bypassCache: opts.bypassCache });
  const ff = completeSignals(r.data);
  const [prev] = await db().select({ v: founderFiles.version }).from(founderFiles).where(eq(founderFiles.applicationId, appId)).orderBy(desc(founderFiles.version)).limit(1);
  await db().insert(founderFiles).values({
    applicationId: appId,
    version: (prev?.v ?? 0) + 1,
    signals: ff.signals,
    founderMarketFit: ff.founder_market_fit,
    redFlags: [...ff.red_flags, ...ff.team_facts.filter((t) => t.flag).map((t) => ({ flag: t.fact, source: t.source }))],
    confidence: ff.confidence,
    callQuestions: ff.call_questions,
    calibrationMemos: { used: ff.memos_used, retrieved: sim.map((m) => ({ company: m.company, decision: m.decision, similarity: m.similarity })), team_facts: ff.team_facts, public_trace: ff.public_trace },
  });
  return { ff, provider: `${r.provider}:${r.model}${r.cached ? " (cached)" : ""}` };
}

registerStep("founder", async (appId, opts) => {
  const [app] = await db().select().from(applications).where(eq(applications.id, appId));
  const excludeMemoId = app?.isBacktest ? memos.find((m) => m.company === app.company)?.id : undefined;
  const { ff, provider } = await buildFounderFile(appId, { ...opts, excludeMemoId });
  const c = ff.signals.reduce<Record<string, number>>((a, s) => ((a[s.state] = (a[s.state] ?? 0) + 1), a), {});
  return { provider, summary: { signals: c, trace: ff.public_trace, conf: ff.confidence } };
});
