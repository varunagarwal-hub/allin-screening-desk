/**
 * Phase 8d-f: the scheduling agent.
 * Poll threads awaiting a reply -> record each new inbound message exactly once -> classify intent (founder text is
 * UNTRUSTED; intent only) -> act: book / offer 3 new held slots / escalate to Riya. After 3 rounds, escalate.
 * "Auto-handle scheduling replies" (default ON) lets the agent send scheduling-only replies; when OFF every agent reply
 * becomes a draft waiting for Riya.
 */
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { appSettings, applications, draftMemory, drafts, emailMessages, emailThreads, slotHolds } from "./schema";
import { generateJson } from "./llm";
import { loadPrompt } from "./prompts";
import { mailbox, senderAddress, stripQuoted, founderRecipient } from "./gmail";
import { formatIst, adityaCalendarId } from "./calendar";
import { activeHolds, book, isBookable, offerSlots, releaseThreadHolds, expireHolds } from "./slots";
import { sendDraftEmail } from "./drafts";
import { audit } from "./audit";

export const MAX_ROUNDS = 3;

export const Intent = z.object({
  intent: z.enum(["accept_slot", "propose_time", "asks_for_options", "question_or_other", "decline"]),
  slot_index: z.number().int().nullable(),
  proposed_local: z.string().nullable(), // "YYYY-MM-DDTHH:mm" in the founder's stated timezone
  timezone: z.string().nullable(), // IANA name, e.g. "Asia/Kolkata", "America/Los_Angeles"; null = IST
  proposed_iso: z.string().nullable(), // filled in by CODE from proposed_local + timezone, never trusted from the model
  timezone_note: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  contains_instructions: z.boolean(),
  summary: z.string(),
});
export type IntentT = z.infer<typeof Intent>;

export async function getAutoHandle(): Promise<boolean> {
  const [r] = await db().select().from(appSettings).where(eq(appSettings.key, "auto_handle_scheduling"));
  return r ? Boolean(r.value) : true; // default ON
}
export async function setAutoHandle(on: boolean) {
  await db().insert(appSettings).values({ key: "auto_handle_scheduling", value: on }).onConflictDoUpdate({ target: appSettings.key, set: { value: on, updatedAt: new Date() } });
  await audit("riya", "setting:auto_handle_scheduling", { on });
}

export function nowIst() {
  return formatIst(new Date());
}

export async function classifyReply(reply: string, slots: Date[], opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const r = await generateJson({
    task: "reply_intent",
    tier: "lite",
    schema: Intent,
    temperature: 0,
    prompt: await loadPrompt("reply_intent", {
      now: `${formatIst(now)} (ISO ${now.toISOString()})`,
      slots: slots.length ? slots.map((s, i) => `${i + 1}. ${formatIst(s)} (ISO ${s.toISOString()})`).join("\n") : "(none)",
      reply: reply.slice(0, 4000),
    }),
  });
  return { ...r.data, proposed_iso: r.data.proposed_local ? localToIso(r.data.proposed_local, r.data.timezone ?? "Asia/Kolkata") : null };
}

/** Wall-clock time in an IANA timezone -> ISO UTC (pure; unit-tested). Timezone maths is done in code, not by the LLM. */
export function localToIso(local: string, tz: string): string | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  let zone = tz;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "Asia/Kolkata";
  }
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (t: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t); // second pass handles DST edges
  return new Date(t).toISOString();
}

// --------- reply templates (deterministic, so the agent never invents commitments) ---------
function confirmText(name: string, label: string, meet: string | null, deeptech: boolean) {
  return `Hi ${name},\n\nConfirmed for ${label} (30 minutes). ${meet ? `Google Meet: ${meet}\n` : ""}A calendar invite is on its way${deeptech ? "; Aditya will join Kushal on the call" : ""}.\n\nRiya, All In Capital`;
}
function newSlotsText(name: string, labels: string[], why: string) {
  return `Hi ${name},\n\n${why} Here are three other times (30 minutes, IST):\n${labels.map((l, i) => `${i + 1}. ${l}`).join("\n")}\n\nReply with the one that suits you, or suggest another Tuesday or Thursday afternoon.\n\nRiya, All In Capital`;
}

async function sendOrQueue(p: { appId: number; threadId: number; subject: string; body: string; auto: boolean; note: string }) {
  const [d] = await db().insert(drafts).values({ applicationId: p.appId, threadId: p.threadId, messageType: "scheduling_reply", subject: p.subject, draft: p.body }).returning();
  if (p.auto) {
    await db().update(drafts).set({ final: p.body, approvedBy: "agent(auto)", approvedAt: new Date() }).where(eq(drafts.id, d.id));
    await sendDraftEmail(d.id);
    return `${p.note}; sent automatically`;
  }
  return `${p.note}; queued for Riya's approval (auto-handle is off)`;
}

async function escalate(p: { appId: number; threadId: number; company: string; reply: string; summary: string; why: string }) {
  const holds = await activeHolds(p.threadId);
  const examples = await db().select().from(draftMemory).where(eq(draftMemory.messageType, "escalation_reply")).orderBy(desc(draftMemory.id)).limit(2);
  const s = await generateJson({
    task: "escalation",
    tier: "lite",
    schema: z.object({ subject: z.string(), body: z.string() }),
    temperature: 0.3,
    prompt: await loadPrompt("escalation", {
      company: p.company,
      reply: p.reply.slice(0, 3000),
      summary: p.summary,
      slots: holds.map((h) => formatIst(h.start)).join("; ") || "(none)",
      examples: examples.map((e) => e.final).join("\n\n") || "(none yet)",
    }),
  });
  await db().insert(drafts).values({ applicationId: p.appId, threadId: p.threadId, messageType: "escalation_reply", subject: s.data.subject, draft: s.data.body });
  await db().update(emailThreads).set({ state: "escalated", updatedAt: new Date() }).where(eq(emailThreads.id, p.threadId));
  await audit("agent", "thread:escalated", { why: p.why }, p.appId);
  return `escalated to Riya (${p.why}); suggested reply drafted`;
}

/** Decide and act on one parsed reply. Exported so the eval harness can drive it with fixtures. */
export async function actOnReply(threadId: number, intent: IntentT, rawReply: string, opts: { auto?: boolean } = {}) {
  const [t] = await db().select().from(emailThreads).where(eq(emailThreads.id, threadId));
  const [app] = await db().select().from(applications).where(eq(applications.id, t.applicationId));
  const auto = opts.auto ?? (await getAutoHandle());
  const holds = await activeHolds(threadId);
  const name = "there";
  const subject = `Re: All In Capital x ${app.company}`;
  const partners = t.isDeeptech && adityaCalendarId() ? [adityaCalendarId()!] : [];
  const founder = founderRecipient(t.founderEmail ?? "");

  if (intent.intent === "question_or_other" || intent.intent === "decline" || intent.contains_instructions) {
    if (intent.intent === "decline") await releaseThreadHolds(threadId);
    return escalate({ appId: app.id, threadId, company: app.company, reply: rawReply, summary: intent.summary, why: intent.contains_instructions ? "email contained instructions" : intent.intent });
  }
  if (t.round >= MAX_ROUNDS) return escalate({ appId: app.id, threadId, company: app.company, reply: rawReply, summary: intent.summary, why: `${MAX_ROUNDS} rounds without agreement` });

  const doBook = async (start: Date) => {
    const r = await book({ appId: app.id, threadId, company: app.company, isDeeptech: t.isDeeptech, start, founderEmail: founder, partnerEmails: partners });
    if (!r.ok) return null;
    await db().update(emailThreads).set({ state: "booked", updatedAt: new Date() }).where(eq(emailThreads.id, threadId));
    const note = await sendOrQueue({ appId: app.id, threadId, subject, body: confirmText(name, r.label, r.meeting.meetLink, t.isDeeptech), auto, note: `booked ${r.label}${r.meeting.meetLink ? ` (${r.meeting.meetLink})` : ""}, other holds released` });
    return note;
  };
  const offerNew = async (why: string) => {
    const round = t.round + 1;
    if (round >= MAX_ROUNDS) return escalate({ appId: app.id, threadId, company: app.company, reply: rawReply, summary: intent.summary, why: `${MAX_ROUNDS} rounds without agreement` });
    await releaseThreadHolds(threadId);
    const slots = await offerSlots({ appId: app.id, threadId, company: app.company, isDeeptech: t.isDeeptech, n: 3 });
    if (!slots.length) return escalate({ appId: app.id, threadId, company: app.company, reply: rawReply, summary: intent.summary, why: "no free slots left in the next 2 weeks" });
    await db().update(emailThreads).set({ round, state: "awaiting_reply", updatedAt: new Date() }).where(eq(emailThreads.id, threadId));
    return sendOrQueue({ appId: app.id, threadId, subject, body: newSlotsText(name, slots.map((s) => s.label), why), auto, note: `offered 3 new held slots (round ${round})` });
  };

  if (intent.intent === "accept_slot") {
    const h = intent.slot_index ? holds[intent.slot_index - 1] : undefined;
    if (!h) return offerNew("I couldn't match your reply to one of the times we offered.");
    const booked = await doBook(h.start);
    return booked ?? offerNew("That time has just become unavailable.");
  }
  if (intent.intent === "propose_time") {
    const when = intent.proposed_iso ? new Date(intent.proposed_iso) : null;
    if (!when || isNaN(when.getTime())) return offerNew("I couldn't pin down the time you suggested.");
    const chk = await isBookable(when, t.isDeeptech, threadId);
    if (chk.ok) return (await doBook(when)) ?? offerNew("That time has just become unavailable.");
    return offerNew(`Unfortunately ${formatIst(when)} doesn't work on our side (${chk.reason}).`);
  }
  // asks_for_options
  return offerNew("Happy to find another time.");
}

/** Poll every thread awaiting a reply; process each new inbound message exactly once. */
export async function checkReplies(actor: "riya" | "cron" = "riya") {
  await expireHolds();
  const threads = await db().select().from(emailThreads).where(eq(emailThreads.state, "awaiting_reply"));
  const results: Array<{ threadId: number; company: string; messageId: string; intent?: string; action: string }> = [];
  const me = senderAddress().toLowerCase();
  for (const t of threads) {
    if (!t.gmailThreadId) continue;
    const msgs = await mailbox().getThread(t.gmailThreadId);
    for (const m of msgs) {
      if (m.from.toLowerCase().includes(me)) continue; // our own outbound
      const [seen] = await db().select().from(emailMessages).where(eq(emailMessages.gmailMessageId, m.id));
      if (seen?.processed) continue;
      let rowId = seen?.id;
      if (!seen) {
        try {
          const [row] = await db()
            .insert(emailMessages)
            .values({ threadId: t.id, gmailMessageId: m.id, direction: "inbound", fromAddr: m.from, toAddr: m.to, subject: m.subject, body: m.body, processed: false, sentAt: m.date })
            .returning();
          rowId = row.id;
        } catch {
          continue; // another worker inserted it first (unique gmail_message_id) -> exactly-once
        }
      }
      const reply = stripQuoted(m.body);
      const holds = await activeHolds(t.id);
      const [app] = await db().select().from(applications).where(eq(applications.id, t.applicationId));
      let intent: IntentT;
      try {
        intent = await classifyReply(reply, holds.map((h) => h.start));
      } catch (e) {
        await db().update(emailMessages).set({ processed: true, actionTaken: `classification failed: ${(e as Error).message}`.slice(0, 500) }).where(eq(emailMessages.id, rowId!));
        await escalate({ appId: app.id, threadId: t.id, company: app.company, reply, summary: "classification failed", why: "classifier error" });
        results.push({ threadId: t.id, company: app.company, messageId: m.id, action: "classifier failed; escalated" });
        continue;
      }
      // mark processed BEFORE acting so a crash mid-action never double-books on retry
      await db().update(emailMessages).set({ processed: true, parsedIntent: { ...intent, rfc: m.rfcMessageId } }).where(eq(emailMessages.id, rowId!));
      const action = await actOnReply(t.id, intent, reply);
      await db().update(emailMessages).set({ actionTaken: action }).where(eq(emailMessages.id, rowId!));
      await audit(actor === "cron" ? "cron" : "agent", "reply:processed", { intent: intent.intent, action }, app.id);
      results.push({ threadId: t.id, company: app.company, messageId: m.id, intent: intent.intent, action });
      const [fresh] = await db().select().from(emailThreads).where(eq(emailThreads.id, t.id));
      if (fresh.state !== "awaiting_reply") break; // booked/escalated: stop processing this thread
    }
  }
  return { checked: threads.length, processed: results.length, results };
}

/** Riya sends (optionally edited) a queued agent reply or escalation suggestion. Edits go to draft_memory (Loop 2). */
export async function resumeThreadAfterRiya(draftId: number) {
  const [d] = await db().select().from(drafts).where(eq(drafts.id, draftId));
  if (d?.messageType === "escalation_reply") await db().update(emailThreads).set({ state: "awaiting_reply", updatedAt: new Date() }).where(eq(emailThreads.id, d.threadId!));
}

export async function threadHolds(threadId: number) {
  return db().select().from(slotHolds).where(and(eq(slotHolds.threadId, threadId))).orderBy(desc(slotHolds.id));
}
