// Phase 7 acceptance: override one lending application, re-score another lending application, show the change.
// The override is a labelled TEST decision ("[acceptance test]"); remove it with: npx tsx scripts/loop1-acceptance.ts reset
import { config } from "dotenv";
config({ path: ".env.local" });
(async () => {
  const { db } = await import("../lib/db");
  const { applications, decisions } = await import("../lib/schema");
  const { eq, and, like } = await import("drizzle-orm");
  await import("../lib/steps");
  const { recordDecision, latestScores } = await import("../lib/memory");
  const { scoreApplication } = await import("../lib/scorer");
  const { businessTypes } = await import("../lib/rules");
  const { latestExtraction } = await import("../lib/pipeline");
  const app = async (n: string) => (await db().select().from(applications).where(and(eq(applications.company, n), eq(applications.isBacktest, false))))[0];
  if (process.argv[2] === "reset") {
    const d = await db().delete(decisions).where(like(decisions.reason, "[acceptance test]%")).returning();
    console.log("removed test decisions:", d.length);
    process.exit(0);
  }
  const src = await app("StockSathi");
  const tgt = await app("Settlr");
  console.log("biz types:", src.company, businessTypes((await latestExtraction(src.id))!), "|", tgt.company, businessTypes((await latestExtraction(tgt.id))!));
  const before = await latestScores(tgt.id);
  const s0 = await latestScores(src.id);
  const ro = s0!.scores.find((s) => s.criterion === "risk_ownership")!;
  const d = await recordDecision({
    appId: src.id, kind: "override", finalCall: "pass", decidedBy: "kushal",
    criterionChanges: [{ criterion: "risk_ownership", old: ro.score, new: 1 }],
    reason: "[acceptance test] Lending model where the form says an NBFC funds credit but the deck says own capital: nobody clearly holds default risk, so risk ownership is 1 until a signed lender agreement shows who takes first loss.",
  });
  console.log("memory lesson:", d.lesson);
  const after = await scoreApplication(tgt.id, { bypassCache: true });
  const b = Object.fromEntries((before?.scores ?? []).map((s) => [s.criterion, s.score]));
  console.log("\n=== Settlr before vs after re-score ===");
  console.log("recommendation:", before?.rec.recommendation, "->", after.out.recommendation);
  for (const c of after.out.criteria) console.log(c.key.padEnd(20), b[c.key], "->", c.score, c.memory_influence.length ? `  MEMORY: ${c.memory_influence.map((m) => `${m.ref}: ${m.effect}`).join(" | ")}` : "");
  console.log("memory in context:", after.rec?.memoryUsed);
  process.exit(0);
})();
