/** Loop 1, step 4: call notes update the founder file and founder score; any change is stored as a correction. */
import { eq } from "drizzle-orm";
import { db } from "./db";
import { callNotes } from "./schema";
import { buildFounderFile } from "./founder";
import { scoreApplication } from "./scorer";
import { latestScores, recordDecision } from "./memory";
import { audit } from "./audit";

export async function addCallNotes(appId: number, author: string, notes: string) {
  const before = await latestScores(appId);
  const [row] = await db().insert(callNotes).values({ applicationId: appId, author, notes }).returning();
  await audit(author as "riya", "call_notes:added", { id: row.id }, appId);
  const ff = await buildFounderFile(appId); // notes are part of the prompt, so the cache key changes
  const after = await scoreApplication(appId);
  const changes = (before?.scores ?? [])
    .map((b) => {
      const a = after.out.criteria.find((c) => c.key === b.criterion);
      return a && a.score !== b.score ? { criterion: b.criterion, old: b.score, new: a.score } : null;
    })
    .filter((c): c is { criterion: string; old: number; new: number } => !!c);
  let correction = null;
  if (changes.length || (before && before.rec.recommendation !== after.out.recommendation)) {
    correction = await recordDecision({
      appId,
      kind: "override",
      finalCall: after.out.recommendation,
      criterionChanges: changes,
      reason: `Call notes (${author}): ${notes.replace(/\s+/g, " ").slice(0, 200)}`,
      decidedBy: author,
      source: "call_notes",
    });
  }
  await db().update(callNotes).set({ resultingChanges: { changes, recommendation: after.out.recommendation, founder_confidence: ff.ff.confidence } }).where(eq(callNotes.id, row.id));
  return { changes, recommendation: after.out.recommendation, correction: correction?.lesson ?? null };
}
