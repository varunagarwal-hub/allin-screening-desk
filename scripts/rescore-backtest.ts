// Re-score backtest memos whose score step failed, then recompute the backtest. Usage: npx tsx scripts/rescore-backtest.ts <label>
import { config } from "dotenv";
config({ path: ".env.local" });
(async () => {
  await import("../lib/steps");
  const { runStep } = await import("../lib/pipeline");
  const { db } = await import("../lib/db");
  const { applications, pipelineSteps } = await import("../lib/schema");
  const { eq, and } = await import("drizzle-orm");
  const ev = await import("../lib/evals");
  const apps = (await db().select().from(applications).where(eq(applications.isBacktest, true))).filter((a) => a.batchId === "backtest");
  for (const a of apps) {
    const [st] = await db().select().from(pipelineSteps).where(and(eq(pipelineSteps.applicationId, a.id), eq(pipelineSteps.step, "score")));
    if (st?.status === "ok") continue;
    const r = await runStep(a.id, "score");
    console.log(a.company, r.ok ? "ok" : r.error);
  }
  const b = await ev.computeBacktest(`${process.argv[2] ?? "cold"} ${new Date().toISOString().slice(0, 16)}`);
  console.log("AGREE", b.agree, "/", b.of, "passed", b.passed);
  for (const x of b.rows) console.log(x.memo, x.company, x.fund, x.system, x.agree ? "agree" : "DISAGREE");
  process.exit(0);
})();
