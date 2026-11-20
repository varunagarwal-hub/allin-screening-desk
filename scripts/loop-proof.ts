// Loop proof on the backtest: record each memo's real outcome as the partner decision (accept when the system agreed,
// override with the memo's own reason when it did not), then re-score warm. Leave-one-out still holds: an app never
// retrieves its own memory entry (retrieveMemory skips the same application).
import { config } from "dotenv";
config({ path: ".env.local" });
(async () => {
  await import("../lib/steps");
  const { db } = await import("../lib/db");
  const { applications, decisions } = await import("../lib/schema");
  const { eq, inArray } = await import("drizzle-orm");
  const { recordDecision, latestScores } = await import("../lib/memory");
  const { memos } = await import("../lib/memos");
  const { runStep } = await import("../lib/pipeline");
  const ev = await import("../lib/evals");
  const apps = (await db().select().from(applications).where(eq(applications.isBacktest, true))).filter((a) => a.batchId === "backtest");
  await db().delete(decisions).where(inArray(decisions.applicationId, apps.map((a) => a.id)));
  for (const a of apps) {
    const m = memos.find((x) => x.company === a.company)!;
    const ls = await latestScores(a.id);
    if (!ls) continue;
    const want = m.decision === "invested" ? "take_call" : "pass";
    const agrees = (ls.rec.recommendation === "take_call") === (want === "take_call");
    const reason = m.why.split(/(?<=\.)\s+/).slice(0, 2).join(" ").slice(0, 380);
    const r = await recordDecision({ appId: a.id, kind: agrees ? "accept" : "override", finalCall: agrees ? ls.rec.recommendation : want, criterionChanges: [], reason: agrees ? undefined : `[backtest] ${reason}`, decidedBy: "kushal" });
    console.log(a.company.padEnd(20), agrees ? "accept" : "OVERRIDE", r.lesson.slice(0, 120));
  }
  await ev.setBacktestMemory(true);
  for (const a of apps) {
    const r = await runStep(a.id, "score", { bypassCache: true });
    console.log(a.company.padEnd(20), "warm score", r.ok ? JSON.stringify(r.summary).slice(0, 120) : r.error);
  }
  await ev.setBacktestMemory(false);
  const b = await ev.computeBacktest(`warm ${new Date().toISOString().slice(0, 16)}`);
  console.log("WARM AGREE", b.agree, "/", b.of);
  for (const x of b.rows) console.log(x.memo, x.company, x.fund, x.system, x.agree ? "agree" : "DISAGREE");
  process.exit(0);
})();
