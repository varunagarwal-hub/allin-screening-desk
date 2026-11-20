"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { api, Btn, Card } from "./ui";

const TYPE_LABEL: Record<string, string> = {
  invite: "Invite",
  deeptech_invite: "Deeptech invite (Aditya joins)",
  pass_note: "Pass note",
  scheduling_reply: "Scheduling reply",
  escalation_reply: "Escalation: suggested reply",
};

export function DraftEditor({ draft, onSent }: { draft: any; onSent: () => void }) {
  const [text, setText] = useState(draft.final ?? draft.draft);
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="rounded border border-zinc-200 p-3 dark:border-zinc-700">
      <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
        <span className="font-semibold text-zinc-700 dark:text-zinc-300">{TYPE_LABEL[draft.messageType] ?? draft.messageType}</span>
        <span>draft #{draft.id}{draft.company ? ` · ${draft.company}` : ""}</span>
      </div>
      <input className="mb-2 w-full rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700" value={subject} onChange={(e) => setSubject(e.target.value)} />
      <textarea className="w-full rounded border border-zinc-300 bg-transparent p-2 font-mono text-sm dark:border-zinc-700" rows={10} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-2 flex items-center gap-2">
        <Btn
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await api<any>(`/api/drafts/${draft.id}/approve`, { json: { final: text, subject } });
            setBusy(false);
            if (!r.ok) return setMsg(r.error);
            setMsg(`Sent to ${r.to}. Edit distance ${r.editDistance} words${r.editTypes?.length ? ` (${r.editTypes.join(", ")})` : ""}.`);
            onSent();
          }}
        >
          {busy ? "Sending…" : "Approve & send"}
        </Btn>
        <span className="text-xs text-zinc-500">Your edits are saved and teach the next draft of this type.</span>
      </div>
      {msg && <p className="mt-1 text-xs text-zinc-600">{msg}</p>}
    </div>
  );
}

export function ThreadTimeline({ thread, messages, holds, meetings }: { thread: any; messages: any[]; holds: any[]; meetings: any[] }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap gap-3 text-xs text-zinc-500">
        <span>
          state: <b className="text-zinc-800 dark:text-zinc-200">{thread.state}</b>
        </span>
        <span>round {thread.round}</span>
        {thread.isDeeptech && <span>deeptech: Aditya&apos;s calendar checked</span>}
        {thread.gmailThreadId && <span>gmail thread {thread.gmailThreadId.slice(0, 10)}…</span>}
      </div>
      {messages.map((m) => (
        <div key={m.id} className={`rounded p-2 ${m.direction === "inbound" ? "bg-sky-50 dark:bg-sky-950" : "bg-zinc-50 dark:bg-zinc-800"}`}>
          <div className="text-xs text-zinc-500">
            {m.direction === "inbound" ? `from ${m.fromAddr}` : `to ${m.toAddr}`} · {m.sentAt ? new Date(m.sentAt).toLocaleString() : ""}
          </div>
          <pre className="mt-1 whitespace-pre-wrap font-sans">{m.body?.slice(0, 800)}</pre>
          {m.parsedIntent && (
            <div className="mt-1 text-xs">
              <b>intent:</b> {m.parsedIntent.intent} ({Math.round((m.parsedIntent.confidence ?? 0) * 100)}%){m.parsedIntent.contains_instructions ? " · ⚠ contained instructions (ignored)" : ""} · {m.parsedIntent.summary}
            </div>
          )}
          {m.actionTaken && (
            <div className="text-xs text-violet-700 dark:text-violet-300">
              <b>action:</b> {m.actionTaken}
            </div>
          )}
        </div>
      ))}
      {holds.length > 0 && (
        <div className="text-xs">
          <b>Slots:</b>{" "}
          {holds.map((h) => (
            <span key={h.id} className={`mr-2 ${h.status === "booked" ? "font-semibold text-emerald-700" : h.status === "held" ? "" : "text-zinc-400 line-through"}`}>
              {new Date(h.start).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} ({h.status})
            </span>
          ))}
        </div>
      )}
      {meetings.map((m) => (
        <div key={m.id} className="rounded bg-emerald-50 p-2 text-xs text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          Booked: {new Date(m.start).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST · {m.meetLink ? <a className="underline" href={m.meetLink}>{m.meetLink}</a> : "no Meet link"} · attendees {m.attendees.join(", ")}
        </div>
      ))}
    </div>
  );
}

export function OutreachPanel({ appId, detail, onChange }: { appId: number; detail: any; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const dec = detail.decisions?.[0];
  const pending = (detail.drafts ?? []).filter((d: any) => !d.sentAt);
  const thread = detail.threads?.[0];
  return (
    <Card title="Outreach">
      {!dec ? (
        <p className="text-sm text-zinc-500">Outreach starts after Kushal&apos;s decision.</p>
      ) : dec.finalCall === "hold" ? (
        <p className="text-sm text-zinc-500">Decision is hold: no founder email until Kushal resolves it.</p>
      ) : (
        <div className="space-y-3">
          {!thread?.gmailThreadId && pending.length === 0 && (
            <Btn
              variant="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const r = await api<any>(`/api/apps/${appId}/draft`, { method: "POST" });
                setBusy(false);
                setMsg(r.ok ? null : r.error);
                onChange();
              }}
            >
              {busy ? "Drafting (holding slots)…" : dec.finalCall === "pass" ? "Draft kind pass note" : "Draft invite with 3 held slots"}
            </Btn>
          )}
          {msg && <p className="text-sm text-red-600">{msg}</p>}
          {pending.map((d: any) => (
            <DraftEditor key={d.id} draft={d} onSent={onChange} />
          ))}
          {thread && <ThreadTimeline thread={thread} messages={(detail.messages ?? []).filter((m: any) => m.threadId === thread.id)} holds={[]} meetings={detail.meetings ?? []} />}
        </div>
      )}
    </Card>
  );
}
