import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { calibrationNotes } from "@/lib/schema";
import { maybeProposeCalibration } from "@/lib/memory";

export async function GET() {
  return Response.json(await db().select().from(calibrationNotes).orderBy(desc(calibrationNotes.id)));
}
/** Manually trigger a proposal pass (also runs automatically after each decision). */
export async function POST() {
  return Response.json(await maybeProposeCalibration());
}
