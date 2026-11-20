// Eval runner. Usage:
//   npx tsx scripts/evals.ts lock
//   npx tsx scripts/evals.ts backtest-create
//   npx tsx scripts/evals.ts backtest <cold|warm>      (runs extract->rules->research(skip)->founder->score for the 12 memos)
//   npx tsx scripts/evals.ts claims | fabrication | email | booking | judge | report
//   npx tsx scripts/evals.ts stability [n_apps]
import { config } from "dotenv";
config({ path: ".env.local" });

(async () => {
  const ev = await import("../lib/evals");
  await import("../lib/steps");
  const { runStep } = await import("../lib/pipeline");
  const { db } = await import("../lib/db");
  const { applications } = await import("../lib/schema");
  const { eq } = await import("drizzle-orm");
  const [cmd, arg] = process.argv.slice(2);
  const print = (x: unknown) => console.log(JSON.stringify(x, null, 1).slice(0, 6000));
  if (cmd === "lock") print(await ev.thresholdsLock());
  else if (cmd === "backtest-create") print(await ev.createBacktestApps());
  else if (cmd === "backtest") {
    const mode = arg === "warm" ? "warm" : "cold";
    await ev.setBacktestMemory(mode === "warm");
    const apps = (await db().select().from(applications).where(eq(applications.isBacktest, true))).filter((a) => a.batchId === "backtest");
    for (const a of apps) {
      const steps: string[] = mode === "cold" ? ["extract", "rules", "research", "founder", "score"] : ["score"];
      for (const s of steps) {
        const t0 = Date.now();
        const r = await runStep(a.id, s as never, { bypassCache: mode === "warm" && s === "score" });
        console.log(`${a.company.padEnd(20)} ${s.padEnd(8)} ${r.ok ? "ok" : "FAILED " + r.error} ${Date.now() - t0}ms ${r.ok ? JSON.stringify(r.summary ?? "") : ""}`);
        if (!r.ok) break;
      }
    }
    print(await ev.computeBacktest(`${mode} ${new Date().toISOString().slice(0, 16)}`));
  } else if (cmd === "claims") print(await ev.claimsSourcedCheck());
  else if (cmd === "fabrication") print(await ev.fabricationCheck());
  else if (cmd === "email") print(await ev.emailIntentEval());
  else if (cmd === "booking") print(await ev.doubleBookingEval());
  else if (cmd === "judge") print(await ev.judgeDisagreements());
  else if (cmd === "stability") {
    const apps = await db().select().from(applications).where(eq(applications.isBacktest, false));
    print(await ev.stabilityRun(apps.slice(0, Number(arg ?? apps.length)).map((a) => a.id)));
  } else if (cmd === "report") console.log(await ev.trustReportMarkdown());
  else console.log("unknown command");
  process.exit(0);
})();
