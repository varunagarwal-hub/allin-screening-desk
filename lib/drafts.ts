/**
 * Phase 8a + Loop 2: drafting outreach, Riya's edit gate, edit distance + edit-type classification into draft_memory,
 * and sending (first email ALWAYS needs Riya's approval).
 */
import { z } from "zod";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "./db";
import { applications, draftMemory, drafts, emailMessages, emailThreads, founderFiles, recommendations, decisions } from "./schema";
import { generateJson } from "./llm";
import { loadPrompt } from "./prompts";
import { latestExtraction } from "./pipeline";
import { offerSlots, activeHolds } from "./slots";
import { formatIst } from "./calendar";
import { founderRecipient, mailbox, isDemoMode } from "./gmail";
import { audit } from "./audit";

export type MessageType = "invite" | "deeptech_invite" | "pass_note" | "scheduling_reply" | "escalation_reply";

/** Word-level Levenshtein distance (pure; unit-tested). */
export function editDistance(a: string, b: string): number {
  const x = a.trim().split(/\s+/).filter(Boolean);
  const y = b.trim().split(/\s+/).filter(Boolean);
  const prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (x[i - 1] === y[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[y.length];
}

const TYPE_RULES: Record<string, string> = {
  invite: "An invitation to a 30-minute intro call with Kushal. Be specific about what caught our attention (one or two concrete things from their application). Offer exactly the 3 slots listed below and ask them to reply with the one that works, or suggest another Tuesday/Thursday afternoon time.",
  deeptech_invite: "An invitation to a 30-minute intro call. Say that Aditya Singh, who leads deeptech at the fund, will join Kushal. Be specific about what caught our attention. Offer exactly the 3 slots below.",
  pass_note: "A kind pass. Give the real reason in one or two sentences. Say what would change our view. If the reason is the model's structure rather than the founders, say so plainly ('this is about the structure, not about you'). Offer a useful introduction ONLY if one is listed under strengths/change (e.g. to a credit/risk operator); otherwise do not offer one. Do not offer a call.",
};

const Draft = z.object({ subject: z.string(), body: z.string() });

async function riyaExamples(type: string, k = 3) {
  const rows = await db().select().from(draftMemory).where(eq(draftMemory.messageType, type as MessageType)).orderBy(desc(draftMemory.id)).limit(k);
  return rows.length ? rows.map((r, i) => `Example ${i + 1}:\n${r.final}`).join("\n\n") : "(none yet)";
}

/** Ensure an email thread row exists for this application. */
export async function ensureThread(appId: number) {
  const [t] = await db().select().from(emailThreads).where(eq(emailThreads.applicationId, appId)).orderBy(desc(emailThreads.id)).limit(1);
  if (t && t.state !== "closed") return t;
  const [app] = await db().select().from(applications).where(eq(applications.id, appId));
  const [row] = await db()
    .insert(emailThreads)
    .values({ applicationId: appId, founderEmail: app.founderEmail ?? `founders@${app.company.toLowerCase().replace(/[^a-z0-9]/g, "")}.example`, isDeeptech: app.isDeeptech, state: "draft", isMock: mailbox().mode === "mock" })
    .returning();
  return row;
}

/** Draft the first outreach after Kushal's decision. */
export async function draftOutreach(appId: number) {
  const [app] = await db().select().from(applications).where(eq(applications.id, appId));
  const [dec] = await db().select().from(decisions).where(eq(decisions.applicationId, appId)).orderBy(desc(decisions.id)).limit(1);
  if (!dec) throw new Error("Kushal has not decided yet. Outreach starts only after a decision.");
  if (dec.finalCall === "hold") throw new Error("Decision is hold: no founder email until Kushal resolves it.");
  const [rec] = await db().select().from(recommendations).where(eq(recommendations.applicationId, appId)).orderBy(desc(recommendations.id)).limit(1);
  const [ff] = await db().select().from(founderFiles).where(eq(founderFiles.applicationId, appId)).orderBy(desc(founderFiles.version)).limit(1);
  const x = await latestExtraction(appId);
  const type: MessageType = dec.finalCall === "pass" ? "pass_note" : app.isDeeptech ? "deeptech_invite" : "invite";
  const thread = await ensureThread(appId);
  let slotText = "";
  if (type !== "pass_note") {
    let holds = await activeHolds(thread.id);
    if (holds.length < 3) {
      await offerSlots({ appId, threadId: thread.id, company: app.company, isDeeptech: app.isDeeptech, n: 3 - holds.length });
      holds = await activeHolds(thread.id);
    }
    if (!holds.length) throw new Error("No free Tue/Thu afternoon slots in the next 2 weeks; ask Riya to propose times manually.");
    slotText = `PROPOSED SLOTS (30 min, IST):\n${holds.map((h, i) => `${i + 1}. ${formatIst(h.start)}`).join("\n")}`;
  }
  const strengths = (ff?.signals as Array<{ signal: string; state: string; evidence: string }> | undefined)?.filter((s) => s.state === "present" && !["pushes_risk", "defensive", "growth_bought", "regulatory_bet"].includes(s.signal)).map((s) => s.evidence).slice(0, 3).join(" | ");
  const r = await generateJson({
    task: "draft",
    schema: Draft,
    temperature: 0.4,
    prompt: await loadPrompt("draft", {
      type,
      type_rules: TYPE_RULES[type],
      company: app.company,
      founders: x?.founders.filter((f) => !f.departed).map((f) => f.name).join(", ") || "the founders",
      decision: `${dec.finalCall}${dec.reason ? ` (Kushal: ${dec.reason})` : ""}`,
      summary: rec?.partnerSummary ?? "",
      strengths: strengths || "(none recorded)",
      change: rec?.whatWouldChange ?? "",
      structure: String((rec?.memoryUsed as { structure_not_people?: boolean } | null)?.structure_not_people ?? false),
      slots: slotText,
      examples: await riyaExamples(type),
    }),
  });
  const [d] = await db().insert(drafts).values({ applicationId: appId, threadId: thread.id, messageType: type, subject: r.data.subject, draft: r.data.body }).returning();
  await audit("agent", "draft:created", { type, draftId: d.id }, appId);
  return d;
}

const EditTypes = z.object({ edit_types: z.array(z.enum(["tone", "length", "specificity_of_reason", "factual_fix", "structure", "slots_or_logistics", "other"])), summary: z.string() });

/** Riya approves (optionally edited) text. Records Loop 2 memory, then sends. */
export async function approveAndSend(draftId: number, finalText: string, approvedBy = "riya", subject?: string) {
  const [d] = await db().select().from(drafts).where(eq(drafts.id, draftId));
  if (!d) throw new Error("draft not found");
  if (d.sentAt) throw new Error("already sent");
  const dist = editDistance(d.draft, finalText);
  let editTypes: string[] = [];
  let editSummary = "";
  if (dist > 0) {
    const c = await generateJson({ task: "edit_classify", tier: "lite", schema: EditTypes, prompt: await loadPrompt("edit_classify", { draft: d.draft, final: finalText }), temperature: 0 });
    editTypes = c.data.edit_types;
    editSummary = c.data.summary;
  }
  await db().update(drafts).set({ final: finalText, subject: subject ?? d.subject, editDistance: dist, editTypes: { types: editTypes, summary: editSummary }, approvedBy, approvedAt: new Date() }).where(eq(drafts.id, draftId));
  await db().insert(draftMemory).values({ draftId, messageType: d.messageType, draft: d.draft, final: finalText, editTypes: { types: editTypes, summary: editSummary } });
  const sent = await sendDraftEmail(draftId);
  await audit(approvedBy as "riya", "draft:approved_sent", { draftId, editDistance: dist, editTypes, type: d.messageType }, d.applicationId);
  return { ...sent, editDistance: dist, editTypes };
}

/** Send a draft's final text in its thread (used by approval and by the agent's auto-replies). */
export async function sendDraftEmail(draftId: number) {
  const [d] = await db().select().from(drafts).where(eq(drafts.id, draftId));
  const [t] = await db().select().from(emailThreads).where(eq(emailThreads.id, d.threadId!));
  const body = d.final ?? d.draft;
  // reply headers: answer the latest inbound message if any
  const [lastIn] = await db().select().from(emailMessages).where(and(eq(emailMessages.threadId, t.id), eq(emailMessages.direction, "inbound"))).orderBy(desc(emailMessages.id)).limit(1);
  const to = founderRecipient(t.founderEmail ?? "");
  const res = await mailbox().send({ to, subject: d.subject ?? "All In Capital", body, threadId: t.gmailThreadId ?? undefined, inReplyTo: (lastIn?.parsedIntent as { rfc?: string } | null)?.rfc });
  await db().insert(emailMessages).values({ threadId: t.id, gmailMessageId: res.id, direction: "outbound", fromAddr: "fund", toAddr: to, subject: d.subject, body, processed: true, actionTaken: `sent ${d.messageType}${isDemoMode() ? " (DEMO_MODE redirect)" : ""}`, sentAt: new Date() });
  const nextState = d.messageType === "pass_note" ? "closed" : d.messageType === "escalation_reply" ? "awaiting_reply" : "awaiting_reply";
  await db().update(emailThreads).set({ gmailThreadId: res.threadId, state: nextState, updatedAt: new Date() }).where(eq(emailThreads.id, t.id));
  await db().update(drafts).set({ sentAt: new Date() }).where(eq(drafts.id, draftId));
  return { messageId: res.id, threadId: res.threadId, to };
}

/** Edit-distance trend per message type (Loop 2 visibility). */
export async function editTrend() {
  const rows = await db().select().from(drafts).where(isNotNull(drafts.editDistance)).orderBy(drafts.approvedAt);
  const byType: Record<string, Array<{ id: number; distance: number; at: string | null; types: string[] }>> = {};
  for (const r of rows) (byType[r.messageType] ??= []).push({ id: r.id, distance: r.editDistance ?? 0, at: r.approvedAt?.toISOString() ?? null, types: (r.editTypes as { types?: string[] } | null)?.types ?? [] });
  return byType;
}
