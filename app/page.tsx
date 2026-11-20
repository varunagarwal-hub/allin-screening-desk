"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, Btn, CRITERIA_LABELS, CRITERIA_ORDER, FlagBadge, RecPill, ScoreDots } from "./_components/ui";

type Row = {
  id: number;
  company: string;
  status: string;
  lastError: string | null;
  sector: string | null;
  businessModel: string | null;
  isDeeptech: boolean;
  recommendation: string | null;
  drivenBy: string | null;
  summary: string | null;
  isWarm: boolean;
  scores: Record<string, number>;
  flags: Array<{ code: string; severity: string; reason: string }>;
  steps: Record<string, { status: string; error: string | null; provider: string | null }>;
  decision: { kind: string; finalCall: string; decidedBy: string } | null;
};
const STEPS = ["extract", "rules", "research", "founder", "score"] as const;

export default function Dashboard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [running, setRunning] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => setRows(await api<Row[]>("/api/apps")), []);
  useEffect(() => {
    load();
  }, [load]);

  async function runApp(r: Row, onlyMissing = true) {
    for (const s of STEPS) {
      if (onlyMissing && r.steps[s]?.status === "ok") continue;
      setRunning((m) => ({ ...m, [r.id]: s }));
      const res = await api<{ ok: boolean; error?: string }>(`/api/apps/${r.id}/run?step=${s}`, { method: "POST" });
      if (!res.ok) break;
    }
    setRunning((m) => {
      const n = { ...m };
      delete n[r.id];
      return n;
    });
    await load();
  }
  async function runAll() {
    if (!rows) return;
    setBusy(true);
    for (const r of rows) await runApp(r); // one application at a time, one request per step
    setBusy(false);
  }

  const counts = (rows ?? []).reduce<Record<string, number>>((a, r) => ((a[r.recommendation ?? "unscored"] = (a[r.recommendation ?? "unscored"] ?? 0) + 1), a), {});

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">This week&apos;s intake</h1>
          <p className="text-sm text-zinc-500">
            {rows?.length ?? 0} applications · {counts.take_call ?? 0} take the call · {counts.hold ?? 0} hold · {counts.pass ?? 0} pass
            {counts.unscored ? ` · ${counts.unscored} not scored yet` : ""}. The system recommends; Kushal decides every one.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/intake">
            <Btn>Add applications</Btn>
          </Link>
          <Btn variant="primary" onClick={runAll} disabled={busy || !rows?.length}>
            {busy ? "Running…" : "Run pipeline for all"}
          </Btn>
        </div>
      </div>

      {rows === null ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No applications yet. <Link className="underline" href="/intake">Upload a batch or press Run now</Link>.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/apps/${r.id}`} className="text-lg font-semibold hover:underline">
                      {r.company}
                    </Link>
                    <RecPill rec={r.recommendation} />
                    {r.drivenBy && <span className="text-xs text-zinc-500">driven by {r.drivenBy} thesis</span>}
                    {r.isWarm && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] text-violet-800 dark:bg-violet-950 dark:text-violet-300">uses past corrections</span>}
                    {r.decision && (
                      <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[11px] text-white dark:bg-zinc-100 dark:text-zinc-900">
                        Kushal: {r.decision.kind} → {r.decision.finalCall.replace("_", " ")}
                      </span>
                    )}
                    <span className="text-xs text-zinc-400">{[r.sector, r.businessModel].filter(Boolean).join(" · ")}</span>
                  </div>
                  {r.summary && <p className="mt-1 whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-300">{r.summary}</p>}
                  <div className="mt-2 flex flex-wrap gap-1">
                    {r.flags.map((f, i) => (
                      <FlagBadge key={i} code={f.code} severity={f.severity} title={f.reason} />
                    ))}
                    {r.isDeeptech && <FlagBadge code="deeptech_routing" severity="info" />}
                  </div>
                </div>
                <div className="grid shrink-0 grid-cols-1 gap-0.5 text-xs">
                  {CRITERIA_ORDER.map((k) => (
                    <div key={k} className="flex items-center justify-between gap-3">
                      <span className="text-zinc-500">{CRITERIA_LABELS[k]}</span>
                      <ScoreDots score={r.scores[k]} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-2 text-xs dark:border-zinc-800">
                {STEPS.map((s) => {
                  const st = running[r.id] === s ? "running" : r.steps[s]?.status ?? "pending";
                  const cls = st === "ok" ? "text-emerald-700" : st === "failed" ? "text-red-600" : st === "running" ? "text-amber-600" : "text-zinc-400";
                  return (
                    <span key={s} className={cls} title={r.steps[s]?.error ?? r.steps[s]?.provider ?? ""}>
                      {st === "ok" ? "✓" : st === "failed" ? "✗" : st === "running" ? "…" : "○"} {s}
                    </span>
                  );
                })}
                {r.lastError && <span className="text-red-600">{r.lastError.slice(0, 120)}</span>}
                <span className="ml-auto" />
                <Btn onClick={() => runApp(r)} disabled={!!running[r.id] || busy}>
                  {running[r.id] ? `Running ${running[r.id]}…` : "Run missing steps"}
                </Btn>
                <Link href={`/apps/${r.id}`}>
                  <Btn>Open</Btn>
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
