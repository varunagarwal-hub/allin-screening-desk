"use client";

import { useCallback, useEffect, useState } from "react";
import { api, Btn, Card } from "../_components/ui";

type Note = { id: number; pattern: string; note: string; scope: Record<string, string | null> | null; basedOnDecisionIds: number[]; status: string; reviewedBy: string | null };

export default function Calibration() {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => setNotes(await api<Note[]>("/api/calibration")), []);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Calibration notes</h1>
          <p className="text-sm text-zinc-500">When 3+ corrections share a pattern, the system proposes a note. Only notes Kushal approves reach the scorer.</p>
        </div>
        <Btn
          onClick={async () => {
            const r = await api<{ proposed?: number; reason?: string }>("/api/calibration", { method: "POST" });
            setMsg(r.proposed ? `${r.proposed} new proposal(s)` : `No proposal: ${r.reason ?? "no pattern found"}`);
            load();
          }}
        >
          Look for patterns now
        </Btn>
      </div>
      {msg && <p className="text-sm text-zinc-600">{msg}</p>}
      {notes?.length === 0 && <p className="text-sm text-zinc-500">No notes yet. Make a few overrides with reasons on the batch screen.</p>}
      {notes?.map((n) => (
        <Card key={n.id} title={`C${n.id} · ${n.status}`} right={n.reviewedBy && <span className="text-xs text-zinc-500">by {n.reviewedBy}</span>}>
          <p className="text-sm">
            <b>Pattern:</b> {n.pattern}
          </p>
          <p className="mt-1 text-sm">
            <b>Note for the scorer:</b> {n.note}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Scope: {Object.entries(n.scope ?? {}).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(", ") || "all"} · based on decisions {n.basedOnDecisionIds.join(", ")}
          </p>
          {n.status === "proposed" && (
            <div className="mt-2 flex gap-2">
              <Btn variant="primary" onClick={async () => (await api(`/api/calibration/${n.id}`, { json: { approve: true } }), load())}>
                Approve
              </Btn>
              <Btn onClick={async () => (await api(`/api/calibration/${n.id}`, { json: { approve: false } }), load())}>Reject</Btn>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
