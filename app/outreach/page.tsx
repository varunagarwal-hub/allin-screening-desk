"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, Btn, Card } from "../_components/ui";
import { DraftEditor, ThreadTimeline } from "../_components/outreach-panel";

export default function Outreach() {
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => setD(await api("/api/outreach")), []);
  useEffect(() => {
    load();
  }, [load]);
  if (!d) return <p className="text-sm text-zinc-500">Loading…</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Outreach & scheduling</h1>
          <p className="text-sm text-zinc-500">
            Mail: {d.mode.mail} · Calendar: {d.mode.calendar}
            {d.mode.demo ? ` · DEMO_MODE: founder emails go to ${d.mode.demoFounder}` : ""}. The first email to a founder always needs Riya&apos;s approval.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={d.autoHandle}
              onChange={async (e) => {
                await api("/api/outreach/settings", { json: { autoHandle: e.target.checked } });
                load();
              }}
            />
            Auto-handle scheduling replies
          </label>
          <Btn
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await api<any>("/api/outreach/check-replies", { method: "POST" });
              setBusy(false);
              setMsg(r.ok ? `Checked ${r.checked} thread(s), processed ${r.processed} new message(s).${r.results.map((x: any) => ` ${x.company}: ${x.intent ?? ""} → ${x.action}.`).join("")}` : r.error);
              load();
            }}
          >
            {busy ? "Checking…" : "Check replies"}
          </Btn>
        </div>
      </div>
      {msg && <p className="rounded bg-zinc-100 p-2 text-sm dark:bg-zinc-800">{msg}</p>}

      <Card title={`Waiting for Riya (${d.pending.length})`}>
        {d.pending.length === 0 ? <p className="text-sm text-zinc-500">Nothing waiting.</p> : <div className="space-y-3">{d.pending.map((p: any) => <DraftEditor key={p.id} draft={p} onSent={load} />)}</div>}
      </Card>

      <Card title="Loop 2: how much Riya edits each message type (words changed per approved draft)">
        {Object.keys(d.trend).length === 0 ? (
          <p className="text-sm text-zinc-500">No approved drafts yet.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {Object.entries(d.trend).map(([type, pts]: [string, any]) => {
              const max = Math.max(1, ...pts.map((p: any) => p.distance));
              const avg = (pts.reduce((a: number, p: any) => a + p.distance, 0) / pts.length).toFixed(1);
              return (
                <div key={type}>
                  <div className="text-sm font-medium">
                    {type} <span className="text-xs text-zinc-500">avg {avg} words · {pts.length} drafts</span>
                  </div>
                  <div className="mt-1 flex h-16 items-end gap-1">
                    {pts.map((p: any) => (
                      <div key={p.id} title={`draft #${p.id}: ${p.distance} words ${p.types.join(", ")}`} className="w-4 rounded-t bg-violet-400" style={{ height: `${Math.max(4, (p.distance / max) * 100)}%` }} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title={`Threads (${d.threads.length})`}>
        {d.threads.length === 0 && <p className="text-sm text-zinc-500">No threads yet. Decide on an application, then draft outreach from its page.</p>}
        <div className="space-y-4">
          {d.threads.map((t: any) => (
            <div key={t.id} className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
              <Link href={`/apps/${t.applicationId}`} className="font-semibold hover:underline">
                {t.company}
              </Link>
              <ThreadTimeline thread={t} messages={t.messages} holds={t.holds} meetings={t.meetings} />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
