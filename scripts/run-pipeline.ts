// CLI runner: npx tsx scripts/run-pipeline.ts <seed|step> [company|all] [step...]
//   npx tsx scripts/run-pipeline.ts seed
//   npx tsx scripts/run-pipeline.ts run StockSathi extract
//   npx tsx scripts/run-pipeline.ts run all extract rules
import { config } from "dotenv";
config({ path: ".env.local" });

(async () => {
  const { db } = await import("../lib/db");
  const { applications } = await import("../lib/schema");
  const { loadSeedApplications } = await import("../lib/intake");
  const { runStep, STEPS } = await import("../lib/pipeline");
  await import("../lib/steps");
  const { eq } = await import("drizzle-orm");
  const [cmd, who, ...steps] = process.argv.slice(2);
  if (cmd === "seed") {
    console.log(JSON.stringify(await loadSeedApplications(), null, 1));
    return;
  }
  const apps = (await db().select().from(applications).where(eq(applications.isBacktest, false))).filter(
    (a) => who === "all" || a.company.toLowerCase() === (who ?? "").toLowerCase(),
  );
  const todo = (steps.length ? steps : STEPS) as Array<(typeof STEPS)[number]>;
  for (const a of apps) {
    for (const s of todo) {
      const t0 = Date.now();
      const r = await runStep(a.id, s);
      console.log(`${a.company.padEnd(12)} ${s.padEnd(9)} ${r.ok ? "ok" : "FAILED"} ${Date.now() - t0}ms ${r.ok ? (r.provider ?? "") + " " + JSON.stringify(r.summary ?? "") : r.error}`);
      if (!r.ok) break;
    }
  }
})();
