// Phase 8 demo: accept (labelled [demo]) two take_call applications, draft invites with held slots, send in DEMO_MODE.
import { config } from "dotenv";
config({ path: ".env.local" });
(async () => {
  await import("../lib/steps");
  const { db } = await import("../lib/db");
  const { applications } = await import("../lib/schema");
  const { eq, and } = await import("drizzle-orm");
  const { recordDecision } = await import("../lib/memory");
  const { draftOutreach, approveAndSend } = await import("../lib/drafts");
  const { isDemoMode } = await import("../lib/gmail");
  if (!isDemoMode()) throw new Error("refusing: DEMO_MODE is off");
  for (const name of process.argv.slice(2)) {
    const [a] = await db().select().from(applications).where(and(eq(applications.company, name), eq(applications.isBacktest, false)));
    await recordDecision({ appId: a.id, kind: "accept", finalCall: "take_call", criterionChanges: [], reason: "[demo] accepted to exercise the Phase 8 scheduling flow", decidedBy: "kushal" });
    const d = await draftOutreach(a.id);
    console.log(`\n=== ${name} (${d.messageType}) ===\nSubject: ${d.subject}\n${d.draft}`);
    const s = await approveAndSend(d.id, d.draft, "riya", d.subject ?? undefined);
    console.log("SENT to", s.to, "gmail thread", s.threadId);
  }
  process.exit(0);
})();
