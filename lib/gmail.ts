/**
 * Mailbox interface with two implementations behind it:
 *  - GmailMailbox: real Gmail API via OAuth refresh token
 *  - MockMailbox:  rows in `mock_mail` (used when Google creds are missing)
 * DEMO_MODE: every founder-bound email is redirected to DEMO_FOUNDER_EMAIL (see sendToFounder).
 */
import { google, gmail_v1 } from "googleapis";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { googleAuth, hasGoogleCreds } from "./google";
import { db } from "./db";
import { mockMail } from "./schema";

export type OutgoingMail = {
  to: string;
  subject: string;
  body: string; // plain text
  threadId?: string; // reply in an existing thread
  inReplyTo?: string; // RFC822 Message-ID header of the message being answered
  cc?: string[];
};
export type MailMessage = {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  date: Date;
  rfcMessageId?: string;
};

export interface Mailbox {
  readonly mode: "gmail" | "mock";
  listLabels(): Promise<string[]>;
  send(m: OutgoingMail): Promise<{ id: string; threadId: string }>;
  getThread(threadId: string): Promise<MailMessage[]>;
  addLabel(messageId: string, label: string): Promise<void>;
}

export function senderAddress() {
  return process.env.FUND_SENDER_EMAIL || "screening@allin.mock";
}

export function isDemoMode() {
  return /^(1|true|yes|on)$/i.test(process.env.DEMO_MODE ?? "");
}

/** Resolve the real recipient for a founder email (DEMO_MODE redirect). Exported for tests. */
export function founderRecipient(founderEmail: string) {
  if (isDemoMode()) {
    const demo = process.env.DEMO_FOUNDER_EMAIL;
    if (!demo) throw new Error("DEMO_MODE is on but DEMO_FOUNDER_EMAIL is not set");
    return demo;
  }
  return founderEmail;
}

// ---------------- RFC 2822 helpers ----------------
function encodeHeader(v: string) {
  return /[^\x20-\x7e]/.test(v) ? `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=` : v;
}

export function buildRaw(from: string, m: OutgoingMail): string {
  const headers = [
    `From: ${from}`,
    `To: ${m.to}`,
    ...(m.cc?.length ? [`Cc: ${m.cc.join(", ")}`] : []),
    `Subject: ${encodeHeader(m.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`, `References: ${m.inReplyTo}`] : []),
  ];
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${m.body}`, "utf8").toString("base64url");
}

function header(h: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string) {
  return h?.find((x) => x.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function extractPlain(p: gmail_v1.Schema$MessagePart | undefined): string {
  if (!p) return "";
  if (p.mimeType === "text/plain" && p.body?.data) return Buffer.from(p.body.data, "base64url").toString("utf8");
  for (const part of p.parts ?? []) {
    const t = extractPlain(part);
    if (t) return t;
  }
  if (p.mimeType === "text/html" && p.body?.data)
    return Buffer.from(p.body.data, "base64url").toString("utf8").replace(/<[^>]+>/g, " ");
  return "";
}

/** Drop quoted history so intent parsing sees only the new text. */
export function stripQuoted(body: string): string {
  const lines = body.split(/\r?\n/);
  const cut = lines.findIndex((l) => /^On .+wrote:\s*$/.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l.trim()));
  return (cut >= 0 ? lines.slice(0, cut) : lines).filter((l) => !l.startsWith(">")).join("\n").trim();
}

// ---------------- Gmail ----------------
class GmailMailbox implements Mailbox {
  readonly mode = "gmail" as const;
  private api = google.gmail({ version: "v1", auth: googleAuth() });

  async listLabels() {
    const r = await this.api.users.labels.list({ userId: "me" });
    return (r.data.labels ?? []).map((l) => l.name ?? "").filter(Boolean);
  }
  async send(m: OutgoingMail) {
    const r = await this.api.users.messages.send({
      userId: "me",
      requestBody: { raw: buildRaw(senderAddress(), m), threadId: m.threadId },
    });
    return { id: r.data.id!, threadId: r.data.threadId! };
  }
  async getThread(threadId: string) {
    const r = await this.api.users.threads.get({ userId: "me", id: threadId, format: "full" });
    return (r.data.messages ?? []).map<MailMessage>((msg) => ({
      id: msg.id!,
      threadId: msg.threadId!,
      from: header(msg.payload?.headers, "From"),
      to: header(msg.payload?.headers, "To"),
      subject: header(msg.payload?.headers, "Subject"),
      body: extractPlain(msg.payload),
      date: new Date(Number(msg.internalDate ?? 0)),
      rfcMessageId: header(msg.payload?.headers, "Message-ID") || undefined,
    }));
  }
  async addLabel(messageId: string, label: string) {
    const labels = await this.api.users.labels.list({ userId: "me" });
    let id = labels.data.labels?.find((l) => l.name === label)?.id;
    if (!id) id = (await this.api.users.labels.create({ userId: "me", requestBody: { name: label } })).data.id!;
    await this.api.users.messages.modify({ userId: "me", id: messageId, requestBody: { addLabelIds: [id] } });
  }
}

// ---------------- Mock ----------------
class MockMailbox implements Mailbox {
  readonly mode = "mock" as const;
  async listLabels() {
    return ["INBOX", "SENT", "MOCK"];
  }
  async send(m: OutgoingMail) {
    const id = `mock-${randomUUID()}`;
    const threadId = m.threadId ?? `mockthread-${randomUUID()}`;
    await db().insert(mockMail).values({
      messageId: id,
      threadId,
      fromAddr: senderAddress(),
      toAddr: m.to,
      subject: m.subject,
      body: m.body,
      labels: ["SENT"],
    });
    return { id, threadId };
  }
  async getThread(threadId: string) {
    const rows = await db().select().from(mockMail).where(eq(mockMail.threadId, threadId)).orderBy(asc(mockMail.createdAt));
    return rows.map<MailMessage>((r) => ({
      id: r.messageId,
      threadId: r.threadId,
      from: r.fromAddr,
      to: r.toAddr,
      subject: r.subject ?? "",
      body: r.body,
      date: r.createdAt,
      rfcMessageId: `<${r.messageId}@mock>`,
    }));
  }
  async addLabel(messageId: string, label: string) {
    const [row] = await db().select().from(mockMail).where(eq(mockMail.messageId, messageId));
    if (!row) return;
    const labels = Array.from(new Set([...(row.labels as string[]), label]));
    await db().update(mockMail).set({ labels }).where(and(eq(mockMail.messageId, messageId)));
  }
  /** Demo/test helper: simulate a founder reply in a mock thread. */
  async injectReply(threadId: string, from: string, body: string, subject = "Re:") {
    const id = `mock-${randomUUID()}`;
    await db().insert(mockMail).values({ messageId: id, threadId, fromAddr: from, toAddr: senderAddress(), subject, body, labels: ["INBOX"] });
    return id;
  }
}

let _mb: Mailbox | null = null;
let _forceMock = false;
/** Evals use the DB-backed mock mailbox so they never send real email. */
export function forceMockMailbox(on: boolean) {
  _forceMock = on;
  _mb = null;
}
export function mailbox(): Mailbox {
  return (_mb ??= hasGoogleCreds() && !_forceMock ? new GmailMailbox() : new MockMailbox());
}
export function mockMailbox(): MockMailbox | null {
  const mb = mailbox();
  return mb instanceof MockMailbox ? mb : null;
}

/** Send an email to a founder, applying the DEMO_MODE redirect. */
export async function sendToFounder(founderEmail: string, m: Omit<OutgoingMail, "to">) {
  return mailbox().send({ ...m, to: founderRecipient(founderEmail) });
}
