import { desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { applications, drafts, emailMessages, emailThreads, meetings, slotHolds } from "@/lib/schema";
import { editTrend } from "@/lib/drafts";
import { getAutoHandle } from "@/lib/scheduler-agent";
import { mailbox, isDemoMode } from "@/lib/gmail";
import { calendar } from "@/lib/calendar";

export async function GET() {
  const [pending, threads, trend, auto] = await Promise.all([
    db().select({ d: drafts, company: applications.company }).from(drafts).innerJoin(applications, eq(applications.id, drafts.applicationId)).where(isNull(drafts.sentAt)).orderBy(desc(drafts.id)),
    db().select({ t: emailThreads, company: applications.company }).from(emailThreads).innerJoin(applications, eq(applications.id, emailThreads.applicationId)).orderBy(desc(emailThreads.updatedAt)),
    editTrend(),
    getAutoHandle(),
  ]);
  const ids = threads.map((t) => t.t.id);
  const [msgs, holds, mtgs] = ids.length
    ? await Promise.all([
        db().select().from(emailMessages).where(inArray(emailMessages.threadId, ids)).orderBy(emailMessages.id),
        db().select().from(slotHolds).where(inArray(slotHolds.threadId, ids)).orderBy(slotHolds.start),
        db().select().from(meetings).where(inArray(meetings.threadId, ids)),
      ])
    : [[], [], []];
  return Response.json({
    autoHandle: auto,
    mode: { mail: mailbox().mode, calendar: calendar().mode, demo: isDemoMode(), demoFounder: isDemoMode() ? process.env.DEMO_FOUNDER_EMAIL : null },
    pending: pending.map((p) => ({ ...p.d, company: p.company })),
    threads: threads.map((t) => ({ ...t.t, company: t.company, messages: msgs.filter((m) => m.threadId === t.t.id), holds: holds.filter((h) => h.threadId === t.t.id), meetings: mtgs.filter((m) => m.threadId === t.t.id) })),
    trend,
  });
}
