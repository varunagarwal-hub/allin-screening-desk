import { db, hasDb } from "./db";
import { auditLog } from "./schema";

export type Actor = "system" | "agent" | "riya" | "kushal" | "aditya" | "cron";

export async function audit(actor: Actor, action: string, details?: Record<string, unknown>, applicationId?: number) {
  if (!hasDb()) {
    console.log("[audit]", actor, action, applicationId ?? "", details ?? "");
    return;
  }
  await db().insert(auditLog).values({ actor, action, applicationId, details });
}
