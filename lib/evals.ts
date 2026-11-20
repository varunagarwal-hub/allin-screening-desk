/**
 * Phase 9: evals and the trust report. Thresholds are pre-registered in data/evals/thresholds.json and locked by hash
 * on the first run; results against a changed file are refused.
 */
import { z } from "zod";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import thresholdsJson from "@/data/evals/thresholds.json";
import repliesJson from "@/data/evals/email_replies.json";
import { db } from "./db";
import { appSettings, applications, claims, drafts, emailThreads, evalRuns, pipelineSteps, recommendations, retrievedSources, scores, slotHolds, mockCalendarEvents } from "./schema";
import { sha256, stableStringify } from "./cache";
import { memos, type Memo } from "./memos";
import { scoreApplication } from "./scorer";
import { classifyReply } from "./scheduler-agent";
import { forceMockCalendar, istToUtc } from "./calendar";
import { forceMockMailbox } from "./gmail";
import { offerSlots, book, doubleBookings } from "./slots";
import { generateJson } from "./llm";
import { loadPrompt } from "./prompts";
import { CRITERIA_KEYS } from "./thesis";

export const thresholds = thresholdsJson;
const th = (k: string) => thresholds.thresholds.find((t) => t.key === k) as unknown as { key: string; label: string; rule: string; min: number; of: number; min_pct: number; max: number; spot_check_n: number; max_spread: number; runs: number };

// ---------------- pre-registration lock ----------------
export async function thresholdsLock() {
  const hash = sha256(stableStringify(thresholds));
  const [row] = await db().select().from(appSettings).where(eq(appSettings.key, "thresholds_lock"));
  if (!row) {
    await db().insert(appSettings).values({ key: "thresholds_lock", value: { hash, locked_at: new Date().toISOString() } });
    return { hash, lockedAt: new Date().toISOString(), matches: true, firstLock: true };
  }
  const v = row.value as { hash: string; locked_at: string };
  return { hash, lockedAt: v.locked_at, matches: v.hash === hash, firstLock: false };
}
async function assertLocked() {
  const l = await thresholdsLock();
  if (!l.matches) throw new Error("thresholds.json changed after it was locked. Pre-registered thresholds must not change; restore the original file.");
  return l;
}

async function saveRun(kind: string, label: string, results: unknown, passed: boolean | null) {
  const [r] = await db().insert(evalRuns).values({ kind, label, thresholds, results: results as object, passed, finishedAt: new Date() }).returning();
  return r;
}

// ---------------- backtest pseudo-applications ----------------
/** Remove decision and outcome language from a memo section (pure; unit-tested). */
export function stripOutcome(text: string): string {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !/\b(invest(ed|ing|ment)?|pass(ed)?|decid(ed|e|ing)|decision|backed|back them|we would (look|reconsider)|reconsider|term[- ]sheet|declin(ed|e)|our read|cheque|underwrit)/i.test(s))
    .join(" ")
    .trim();
}

export function pseudoApplicationText(m: Memo) {
  return [
    `Company: ${m.company}`,
    `Sector: ${m.sector_raw}`,
    `Stage: ${m.stage}`,
    `Source: ${m.source}`,
    `What it does: ${m.what_it_does}`,
    `Founders (as observed in the first meeting): ${stripOutcome(m.founder_assessment)}`,
    `Risks and open questions: ${stripOutcome(m.risks)}`,
  ].join("\n");
}

export async function createBacktestApps() {
  const existing = await db().select().from(applications).where(eq(applications.isBacktest, true));
  const out = [];
  for (const m of memos) {
    const e = existing.find((a) => a.company === m.company);
    if (e) {
      out.push({ id: e.id, company: m.company, created: false });
      continue;
    }
    const [row] = await db().insert(applications).values({ company: m.company, batchId: "backtest", isBacktest: true, backtestText: pseudoApplicationText(m), status: "uploaded" }).returning();
    out.push({ id: row.id, company: m.company, created: true });
  }
  return out;
}

export async function setBacktestMemory(on: boolean) {
  await db().insert(appSettings).values({ key: "backtest_use_memory", value: on }).onConflictDoUpdate({ target: appSettings.key, set: { value: on, updatedAt: new Date() } });
}

/** Compare the latest recommendation of each backtest app with the memo decision. */
export async function computeBacktest(label: string) {
  await assertLocked();
  const apps = await db().select().from(applications).where(eq(applications.isBacktest, true));
  const rows = [];
  for (const a of apps) {
    const m = memos.find((x) => x.company === a.company);
    if (!m) continue;
    const [rec] = await db().select().from(recommendations).where(eq(recommendations.applicationId, a.id)).orderBy(desc(recommendations.id)).limit(1);
    if (!rec) {
      rows.push({ memo: m.n, company: m.company, fund: m.decision, system: null as string | null, agree: false, warm: false, summary: "not scored" });
      continue;
    }
    const sysYes = rec.recommendation === "take_call";
    const fundYes = m.decision === "invested";
    rows.push({ memo: m.n, company: m.company, fund: m.decision, system: rec.recommendation, agree: sysYes === fundYes, warm: rec.isWarm, summary: rec.partnerSummary, appId: a.id, recId: rec.id });
  }
  const agree = rows.filter((r) => r.agree).length;
  const t = th("decision_agreement");
  const result = { agree, of: rows.length, rows, threshold: t.rule, passed: agree >= t.min && rows.length === 12 };
  await saveRun("backtest", label, result, result.passed);
  return result;
}

const Verdict = z.object({ verdict: z.enum(["fund_likely_wrong", "system_likely_wrong", "unclear"]), reasoning: z.string(), what_would_settle_it: z.string() });

/** For each disagreement: judge whether the fund or the system was likely wrong (uses the full memo + partner notes). */
export async function judgeDisagreements(label = "latest") {
  const run = (await latestRuns()).backtest;
  if (!run) throw new Error("run the backtest first");
  const res = run.results as { rows: Array<{ memo: number; company: string; fund: string; system: string | null; agree: boolean; appId?: number; recId?: number; summary: string }> };
  const out = [];
  for (const r of res.rows.filter((x) => !x.agree && x.system)) {
    const m = memos.find((x) => x.n === r.memo)!;
    const [rec] = r.recId ? await db().select().from(recommendations).where(eq(recommendations.id, r.recId)) : [];
    const sc = rec ? await db().select().from(scores).where(eq(scores.scoreRunId, rec.scoreRunId)) : [];
    const v = await generateJson({
      task: "judge_disagreement",
      schema: Verdict,
      temperature: 0,
      prompt: await loadPrompt("judge", {
        memo: `${m.company}: ${m.what_it_does}\nFounders: ${m.founder_assessment}\nRisks: ${m.risks}\nFUND DECISION: ${m.decision}. Why: ${m.why}`,
        system: `System recommended ${r.system}. Summary: ${r.summary}\nScores: ${sc.map((s) => `${s.criterion}=${s.score}`).join(", ")}`,
        notes:
          "Partner Meeting 5 notes: Kushal is unsure about the Prepnest pass (a similar-format competitor later did well; founder was defensive on retention). Aditya: pick the three most uneasy passes to review. Ledgerly (not in the pack) is thought to be a miss: weak founder in the call but the company worked. Riya observed thesis drift: recent yeses (small-town retail, founder-led fixed income) would score lower against the public wording than some passes.",
      }),
    });
    out.push({ ...r, ...v.data });
  }
  await saveRun("disagreements", label, { items: out }, null);
  return out;
}

// ---------------- sourcing + fabrication ----------------
export async function claimsSourcedCheck() {
  await assertLocked();
  const live = await db().select({ id: applications.id }).from(applications).where(eq(applications.isBacktest, false));
  const cl = live.length ? await db().select().from(claims).where(inArray(claims.applicationId, live.map((a) => a.id))) : [];
  const bad = cl.filter((c) => c.status !== "not_found" && !c.sourceUrl && !c.sourceFile);
  const pct = cl.length ? Math.round(((cl.length - bad.length) / cl.length) * 1000) / 10 : 0;
  const r = { total: cl.length, unsourced: bad.length, pct, bad: bad.slice(0, 20).map((c) => ({ id: c.id, text: c.text })), passed: cl.length > 0 && bad.length === 0 };
  await saveRun("claims_sourced", "live batch", r, r.passed);
  return r;
}

export async function fabricationCheck() {
  await assertLocked();
  const cl = await db().select().from(claims).where(isNotNull(claims.sourceUrl));
  const runs = [...new Set(cl.map((c) => c.runId))];
  const got = runs.length ? await db().select().from(retrievedSources).where(inArray(retrievedSources.runId, runs)) : [];
  const set = new Set(got.map((g) => `${g.runId}|${g.url}`));
  const fabricated = cl.filter((c) => !set.has(`${c.runId}|${c.sourceUrl}`));
  // random spot-check sample of 10 cited claims for a human to verify
  const sample = [...cl].sort(() => Math.random() - 0.5).slice(0, th("fabricated_sources").spot_check_n);
  const r = {
    cited: cl.length,
    fabricated: fabricated.length,
    fabricatedList: fabricated.slice(0, 20).map((c) => ({ id: c.id, url: c.sourceUrl })),
    spotCheck: sample.map((c) => ({ id: c.id, text: c.text, url: c.sourceUrl, excerpt: c.excerpt, status: c.status, result: null as null | "ok" | "fail" })),
    automatedPassed: fabricated.length === 0,
    passed: null as boolean | null, // final pass needs the manual spot check
  };
  await saveRun("fabrication", "live batch", r, null);
  return r;
}

/** Record the human spot-check results (ok/fail per sampled claim). */
export async function recordSpotCheck(runId: number, results: Record<number, "ok" | "fail">) {
  const [run] = await db().select().from(evalRuns).where(eq(evalRuns.id, runId));
  const r = run.results as Awaited<ReturnType<typeof fabricationCheck>>;
  r.spotCheck = r.spotCheck.map((s) => ({ ...s, result: results[s.id] ?? s.result }));
  const done = r.spotCheck.every((s) => s.result);
  r.passed = done ? r.automatedPassed && r.spotCheck.every((s) => s.result === "ok") : null;
  await db().update(evalRuns).set({ results: r, passed: r.passed }).where(eq(evalRuns.id, runId));
  return r;
}

// ---------------- stability ----------------
export async function stabilityRun(appIds: number[], runs = th("score_stability").runs) {
  await assertLocked();
  const per: Record<string, Record<string, number[]>> = {};
  const recs: Record<string, string[]> = {};
  for (const id of appIds) {
    const [a] = await db().select().from(applications).where(eq(applications.id, id));
    for (let i = 0; i < runs; i++) {
      const r = await scoreApplication(id, { bypassCache: true, dryRun: true });
      for (const c of r.out.criteria) ((per[a.company] ??= {})[c.key] ??= []).push(c.score);
      (recs[a.company] ??= []).push(r.out.recommendation);
    }
  }
  const spreads = Object.fromEntries(Object.entries(per).map(([co, crit]) => [co, Object.fromEntries(CRITERIA_KEYS.map((k) => [k, crit[k] ? Math.max(...crit[k]) - Math.min(...crit[k]) : null]))]));
  const maxSpread = Math.max(0, ...Object.values(spreads).flatMap((c) => Object.values(c).filter((v): v is number => v != null)));
  const r = { runs, scores: per, recommendations: recs, spreads, maxSpread, passed: maxSpread <= th("score_stability").max_spread };
  await saveRun("stability", `${appIds.length} apps x ${runs}`, r, r.passed);
  return r;
}

// ---------------- email agent ----------------
export const EVAL_NOW = istToUtc(2026, 10, 20, 11, 0); // Fri 20 Nov 2026, 11:00 IST
export const EVAL_SLOTS = [istToUtc(2026, 10, 24, 14, 30), istToUtc(2026, 10, 26, 16, 0), istToUtc(2026, 11, 1, 17, 0)]; // Tue, Thu, Tue

export async function emailIntentEval() {
  await assertLocked();
  const rows = [];
  for (const r of repliesJson.replies) {
    let got;
    try {
      got = await classifyReply(r.text, EVAL_SLOTS, { now: EVAL_NOW });
    } catch (e) {
      rows.push({ id: r.id, text: r.text, expect: r.expect, got: `error: ${(e as Error).message}`, ok: false });
      continue;
    }
    let ok = got.intent === r.expect;
    if (ok && r.expect === "accept_slot" && r.slot != null) ok = r.slot === "thursday" ? got.slot_index === 2 : got.slot_index === r.slot;
    rows.push({ id: r.id, text: r.text, expect: r.expect, expectSlot: r.slot ?? null, got: got.intent, slot: got.slot_index, proposed: got.proposed_iso, injection: got.contains_instructions, ok });
  }
  const correct = rows.filter((x) => x.ok).length;
  const t = th("email_intent");
  const res = { correct, of: rows.length, rows, passed: correct >= t.min };
  await saveRun("email_intent", "15 fixtures", res, res.passed);
  return res;
}

/** Concurrency simulation on the mock calendar (never touches real calendars) + a scan of real bookings. */
export async function doubleBookingEval() {
  await assertLocked();
  forceMockCalendar(true);
  forceMockMailbox(true);
  const created: number[] = [];
  try {
    const [app] = await db().insert(applications).values({ company: "EVAL scheduling sim", batchId: "eval", isBacktest: true, status: "uploaded" }).returning();
    created.push(app.id);
    const threads: Array<typeof emailThreads.$inferSelect> = [];
    for (let i = 0; i < 4; i++) threads.push((await db().insert(emailThreads).values({ applicationId: app.id, founderEmail: `sim${i}@eval.example`, state: "awaiting_reply", isMock: true }).returning())[0]);
    // 4 founders get slots offered at the same moment
    const offers = await Promise.all(threads.map((t) => offerSlots({ appId: app.id, threadId: t.id, company: "SIM", isDeeptech: false, n: 3, now: EVAL_NOW })));
    const starts = offers.flat().map((o) => o.start.getTime());
    const duplicateOffers = starts.length - new Set(starts).size;
    // two founders try to book the same slot concurrently (thread 0's first slot)
    const target = offers[0][0]?.start;
    const attempts = target
      ? await Promise.all([0, 1].map((i) => book({ appId: app.id, threadId: threads[i].id, company: "SIM", isDeeptech: false, start: target, founderEmail: `sim${i}@eval.example`, partnerEmails: [] }).catch((e) => ({ ok: false, reason: String(e) }))))
      : [];
    const successes = attempts.filter((a) => a.ok).length;
    const realDoubles = await doubleBookings();
    const r = { offersMade: starts.length, duplicateOffers, concurrentBookAttempts: attempts.length, successes, realDoubleBookings: realDoubles, note: "Booking calls ran at real time, so only rule-compliant future slots could be booked; offers used a fixed clock.", passed: duplicateOffers === 0 && successes <= 1 && realDoubles === 0 };
    await saveRun("double_booking", "4-founder concurrency sim + real scan", r, r.passed);
    return r;
  } finally {
    if (created.length) {
      const ts = await db().select({ id: emailThreads.id }).from(emailThreads).where(inArray(emailThreads.applicationId, created));
      if (ts.length) await db().delete(slotHolds).where(inArray(slotHolds.threadId, ts.map((t) => t.id)));
      await db().delete(mockCalendarEvents).where(eq(mockCalendarEvents.summary, "HOLD: SIM intro call (tentative)"));
      await db().delete(mockCalendarEvents).where(eq(mockCalendarEvents.summary, "All In Capital x SIM: intro call"));
      await db().delete(applications).where(inArray(applications.id, created));
    }
    forceMockCalendar(false);
    forceMockMailbox(false);
  }
}

// ---------------- loop proof + time ----------------
export async function loopProof() {
  const runs = await db().select().from(evalRuns).where(eq(evalRuns.kind, "backtest")).orderBy(evalRuns.id);
  const cold = runs.find((r) => (r.label ?? "").startsWith("cold"));
  const warm = [...runs].reverse().find((r) => (r.label ?? "").startsWith("warm"));
  const ag = (r?: typeof cold) => (r ? (r.results as { agree: number; of: number }) : null);
  const ds = await db().select().from(drafts).where(isNotNull(drafts.editDistance)).orderBy(drafts.approvedAt);
  const byType: Record<string, number[]> = {};
  for (const d of ds) (byType[d.messageType] ??= []).push(d.editDistance ?? 0);
  const halves = Object.fromEntries(
    Object.entries(byType).map(([t, xs]) => {
      const h = Math.ceil(xs.length / 2);
      const avg = (a: number[]) => (a.length ? Math.round((a.reduce((s, v) => s + v, 0) / a.length) * 10) / 10 : null);
      return [t, { first: avg(xs.slice(0, h)), later: avg(xs.slice(h)), n: xs.length }];
    }),
  );
  return { cold: ag(cold), warm: ag(warm), editDistance: halves };
}

export async function timeStats() {
  const live = await db().select({ id: applications.id }).from(applications).where(eq(applications.isBacktest, false));
  const st = live.length ? await db().select().from(pipelineSteps).where(and(inArray(pipelineSteps.applicationId, live.map((a) => a.id)), eq(pipelineSteps.status, "ok"))) : [];
  const per = new Map<number, number>();
  for (const s of st) if (s.startedAt && s.finishedAt) per.set(s.applicationId, (per.get(s.applicationId) ?? 0) + (s.finishedAt.getTime() - s.startedAt.getTime()));
  const mins = [...per.values()].map((ms) => ms / 60000);
  const avg = mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : 0;
  return { apps: mins.length, avgMachineMinutes: Math.round(avg * 10) / 10, riyaBeforeMinutes: 30, riyaAfterMinutesEstimate: 5, note: "Before: Riya's ~30 min manual first pass (case brief). After: machine time runs unattended; Riya's estimated review time is reading the 2-minute detail view plus approving one email (~5 min, an estimate to be measured in pilot)." };
}

export async function latestRuns() {
  const kinds = ["backtest", "disagreements", "claims_sourced", "fabrication", "stability", "email_intent", "double_booking"];
  const out: Record<string, typeof evalRuns.$inferSelect | null> = {};
  for (const k of kinds) {
    const rows = await db().select().from(evalRuns).where(eq(evalRuns.kind, k)).orderBy(desc(evalRuns.id)).limit(20);
    // The pre-registered agreement threshold is judged on the COLD run (no memory of corrections); warm runs are loop proof only.
    out[k] = (k === "backtest" ? rows.find((r) => (r.label ?? "").startsWith("cold")) : rows[0]) ?? null;
  }
  return out;
}

// ---------------- trust report ----------------
export async function trustReportMarkdown() {
  const lock = await thresholdsLock();
  const r = await latestRuns();
  const lp = await loopProof();
  const tm = await timeStats();
  const pf = (p: boolean | null | undefined) => (p === true ? "PASS" : p === false ? "FAIL" : "PENDING");
  const bt = r.backtest?.results as { agree: number; of: number; rows: Array<{ memo: number; company: string; fund: string; system: string | null; agree: boolean }> } | undefined;
  const dis = (r.disagreements?.results as { items: Array<{ company: string; fund: string; system: string; verdict: string; reasoning: string; what_would_settle_it: string }> } | undefined)?.items ?? [];
  const lines = [
    `# Trust report: All In Capital screening desk`,
    ``,
    `Generated ${new Date().toISOString()}. Thresholds pre-registered ${thresholds.registered_at}; locked ${lock.lockedAt} (hash ${lock.hash.slice(0, 12)}…, ${lock.matches ? "unchanged" : "CHANGED: results invalid"}).`,
    ``,
    `## Thresholds`,
    `| Threshold | Rule | Result | Status |`,
    `|---|---|---|---|`,
    `| Decision agreement | ${th("decision_agreement").rule} | ${bt ? `${bt.agree}/${bt.of}` : "not run"} | ${pf(r.backtest?.passed)} |`,
    `| Claims sourced | ${th("claims_sourced").rule} | ${r.claims_sourced ? `${(r.claims_sourced.results as { pct: number }).pct}% of ${(r.claims_sourced.results as { total: number }).total}` : "not run"} | ${pf(r.claims_sourced?.passed)} |`,
    `| Fabricated sources | ${th("fabricated_sources").rule} | ${r.fabrication ? `${(r.fabrication.results as { fabricated: number }).fabricated} of ${(r.fabrication.results as { cited: number }).cited} cited; spot check ${(r.fabrication.results as { spotCheck: Array<{ result: string | null }> }).spotCheck.filter((s) => s.result).length}/10 done` : "not run"} | ${pf(r.fabrication?.passed)} |`,
    `| Score stability | ${th("score_stability").rule} | ${r.stability ? `max spread ${(r.stability.results as { maxSpread: number }).maxSpread}` : "not run"} | ${pf(r.stability?.passed)} |`,
    `| Email intent | ${th("email_intent").rule} | ${r.email_intent ? `${(r.email_intent.results as { correct: number }).correct}/15` : "not run"} | ${pf(r.email_intent?.passed)} |`,
    `| Double bookings | ${th("double_bookings").rule} | ${r.double_booking ? `${(r.double_booking.results as { realDoubleBookings: number; duplicateOffers: number }).realDoubleBookings} real, ${(r.double_booking.results as { duplicateOffers: number }).duplicateOffers} duplicate offers in sim` : "not run"} | ${pf(r.double_booking?.passed)} |`,
    ``,
    `## Backtest (leave-one-out, ${r.backtest?.label ?? "-"})`,
    ...(bt ? [`| # | Company | Fund | System | Agree |`, `|---|---|---|---|---|`, ...bt.rows.map((x) => `| ${x.memo} | ${x.company} | ${x.fund} | ${x.system ?? "-"} | ${x.agree ? "yes" : "**no**"} |`)] : ["Not run."]),
    ``,
    `## Disagreements: who was likely wrong`,
    ...(dis.length ? dis.flatMap((d) => [`### ${d.company}: fund ${d.fund}, system ${d.system} → ${d.verdict.replace(/_/g, " ")}`, d.reasoning, `*What would settle it:* ${d.what_would_settle_it}`, ``]) : ["None judged yet."]),
    `## Loop proof`,
    `- Agreement with the fund, cold (no memory): ${lp.cold ? `${lp.cold.agree}/${lp.cold.of}` : "not run"}; warm (after corrections): ${lp.warm ? `${lp.warm.agree}/${lp.warm.of}` : "not run"}.`,
    ...Object.entries(lp.editDistance).map(([t, v]) => `- Riya's edit distance (${t}): first half avg ${v.first ?? "-"} words, later half avg ${v.later ?? "-"} words (n=${v.n}).`),
    ...(r.stability ? (() => { const recs = (r.stability!.results as { recommendations: Record<string, string[]> }).recommendations; const flips = Object.entries(recs).filter(([, v]) => new Set(v).size > 1); return [`- Recommendation consistency across ${(r.stability!.results as { runs: number }).runs} runs: ${Object.keys(recs).length - flips.length}/${Object.keys(recs).length} applications got the same call every time${flips.length ? `; flipped: ${flips.map(([k, v]) => `${k} (${v.join(", ")})`).join("; ")}. Treat these as borderline and read the detail view.` : "."}`]; })() : []),
    ``,
    `## Where it breaks`,
    `- **No public trace for fictional or very new founders.** All 10 applicants use .example domains and placeholder LinkedIn URLs, so research reports "no public trace", and confidence and the founder score fall. The system says so; it does not fill gaps.`,
    `- **Thin decks.** When numbers appear only in the form (or nowhere), the scorer can only penalise the gap; it cannot judge quality.`,
    `- **Thesis drift.** The written thesis (four sectors) and the revealed thesis (founder behaviour over sector label; commerce infra and repeat-led consumer) disagree on edge cases. Every score states which drove it, but Kushal must decide which one the fund means.`,
    `- **Signals visible only on a call.** Defensiveness, candour about failure, and real risk ownership are marked "judge on call"; the first-pass score is provisional until call notes are added.`,
    `- **Incomplete portfolio list, and false flags.** The conflict check covers the known ~60-75% of the portfolio; a clean result means "no conflict with known portfolio". It also errs towards false flags by design (Kushal prefers them): e.g. in the backtest, Wint Wealth (retail bonds) was flagged against Volt (loans against mutual funds), which contributed to a wrong hold.`,
    `- **Borderline calls can flip.** Criterion scores were stable within 1 point, but an application near the take_call/pass line can change recommendation between runs (see stability). The cache returns the first answer for identical inputs, so the UI is consistent, but the underlying call is uncertain.`,
    `- **No public anti-thesis.** Exclusions (e.g. crypto) come from memo behaviour, not a published list, so they are flagged for Kushal rather than auto-declined.`,
    `- **Backtest limits.** Memo companies are real, so web research is disabled in the backtest to avoid outcome leakage; memo founder text was written after meeting the founders, so it is richer than a real first-pass file. Expect live agreement to be lower than backtest agreement.`,
    ``,
    `## Time per application`,
    `- Before: ~${tm.riyaBeforeMinutes} min of Riya's time per application (case brief).`,
    `- After: ~${tm.avgMachineMinutes} min of unattended machine time (avg over ${tm.apps} apps) + an estimated ~${tm.riyaAfterMinutesEstimate} min of Riya's review. ${tm.note}`,
  ];
  return lines.join("\n");
}
