"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import { api, Btn, Card } from "../_components/ui";

const pf = (p: boolean | null | undefined) =>
  p === true ? <span className="font-semibold text-emerald-700">PASS</span> : p === false ? <span className="font-semibold text-red-700">FAIL</span> : <span className="text-zinc-500">pending</span>;

export default function Evals() {
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [spot, setSpot] = useState<Record<number, "ok" | "fail">>({});
  const load = useCallback(async () => setD(await api("/api/evals")), []);
  useEffect(() => {
    load();
  }, [load]);
  const run = async (kind: string) => {
    setBusy(kind);
    const r = await api<any>(`/api/evals/run?kind=${kind}`, { method: "POST" });
    setBusy(null);
    setMsg(r.ok ? `${kind} done` : r.error);
    load();
  };
  if (!d) return <p className="text-sm text-zinc-500">Loading…</p>;
  const R = d.runs;
  const res = (k: string) => R[k]?.results;
  const fab = R.fabrication;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Evals</h1>
      <Card title="Pre-registered thresholds (fixed before any run; never changed)">
        <p className="mb-2 text-xs text-zinc-500">
          Registered {d.thresholds.registered_at}. Locked {d.lock.lockedAt} · hash {d.lock.hash.slice(0, 12)}… ·{" "}
          {d.lock.matches ? <span className="text-emerald-700">file unchanged since lock</span> : <span className="font-semibold text-red-700">FILE CHANGED AFTER LOCK: results invalid</span>}
        </p>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-zinc-500">
            <tr>
              <th>Threshold</th>
              <th>Rule</th>
              <th>Latest result</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="py-1.5">Decision agreement</td>
              <td>≥ 9/12</td>
              <td>{res("backtest") ? `${res("backtest").agree}/${res("backtest").of} (${R.backtest.label})` : "–"}</td>
              <td>{pf(R.backtest?.passed)}</td>
            </tr>
            <tr className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="py-1.5">Claims sourced</td>
              <td>100%</td>
              <td>{res("claims_sourced") ? `${res("claims_sourced").pct}% of ${res("claims_sourced").total}` : "–"}</td>
              <td>{pf(R.claims_sourced?.passed)}</td>
            </tr>
            <tr className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="py-1.5">Fabricated sources</td>
              <td>0 + manual spot check of 10</td>
              <td>{fab ? `${fab.results.fabricated} of ${fab.results.cited} cited not retrieved` : "–"}</td>
              <td>{pf(fab?.passed)}</td>
            </tr>
            <tr className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="py-1.5">Score stability</td>
              <td>≤ 1 point per criterion, 3 runs</td>
              <td>{res("stability") ? `max spread ${res("stability").maxSpread}` : "– (run scripts/evals.ts stability)"}</td>
              <td>{pf(R.stability?.passed)}</td>
            </tr>
            <tr className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="py-1.5">Email intent</td>
              <td>≥ 13/15</td>
              <td>{res("email_intent") ? `${res("email_intent").correct}/15` : "–"}</td>
              <td>{pf(R.email_intent?.passed)}</td>
            </tr>
            <tr className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="py-1.5">Double bookings</td>
              <td>0</td>
              <td>{res("double_booking") ? `${res("double_booking").realDoubleBookings} real · ${res("double_booking").duplicateOffers} dup offers · ${res("double_booking").successes}/2 concurrent books` : "–"}</td>
              <td>{pf(R.double_booking?.passed)}</td>
            </tr>
          </tbody>
        </table>
        <div className="mt-3 flex flex-wrap gap-2">
          {["claims", "fabrication", "email", "booking", "backtest_compute", "judge"].map((k) => (
            <Btn key={k} disabled={!!busy} onClick={() => run(k)}>
              {busy === k ? "Running…" : `Run ${k.replace("_", " ")}`}
            </Btn>
          ))}
        </div>
        <p className="mt-2 text-xs text-zinc-500">Backtest scoring (12 memos × 3 LLM steps) and stability runs take ~25 min: run <code>npx tsx scripts/evals.ts backtest cold|warm</code> and <code>npx tsx scripts/evals.ts stability</code>, then press &quot;Run backtest compute&quot;.</p>
        {msg && <p className="mt-1 text-sm">{msg}</p>}
      </Card>

      {res("backtest") && (
        <Card title={`Backtest (leave-one-out) · ${R.backtest.label}`}>
          <table className="w-full text-sm">
            <tbody>
              {res("backtest").rows.map((r: any) => (
                <tr key={r.memo} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                  <td className="py-1.5 pr-2 text-zinc-400">{r.memo}</td>
                  <td className="pr-2 font-medium">{r.company}</td>
                  <td className="pr-2">fund: {r.fund}</td>
                  <td className="pr-2">system: {r.system ?? "–"}</td>
                  <td className={r.agree ? "text-emerald-700" : "font-semibold text-red-700"}>{r.agree ? "agree" : "disagree"}</td>
                  <td className="whitespace-pre-line pl-2 text-xs text-zinc-500">{r.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {res("disagreements")?.items?.length > 0 && (
        <Card title="Disagreements: who was likely wrong">
          {res("disagreements").items.map((x: any) => (
            <div key={x.memo} className="mb-3 text-sm">
              <b>{x.company}</b>: fund {x.fund}, system {x.system} → <b>{x.verdict.replace(/_/g, " ")}</b>
              <p>{x.reasoning}</p>
              <p className="text-xs text-zinc-500">What would settle it: {x.what_would_settle_it}</p>
            </div>
          ))}
        </Card>
      )}

      {fab && (
        <Card title={`Manual spot check of cited sources (${fab.results.spotCheck.length} sampled)`}>
          <p className="mb-2 text-xs text-zinc-500">Open each link and confirm the excerpt is really on the page and supports the status. Only a human can complete this check.</p>
          {fab.results.spotCheck.map((s: any) => (
            <div key={s.id} className="mb-2 border-t border-zinc-100 pt-2 text-sm dark:border-zinc-800">
              <div>
                #{s.id} [{s.status}] {s.text}
              </div>
              <a className="text-xs text-sky-700 underline" href={s.url} target="_blank" rel="noreferrer">
                {s.url}
              </a>
              <div className="text-xs text-zinc-500">“{s.excerpt}”</div>
              <div className="mt-1 flex gap-3 text-xs">
                {(["ok", "fail"] as const).map((v) => (
                  <label key={v} className="flex items-center gap-1">
                    <input type="radio" name={`s${s.id}`} checked={(spot[s.id] ?? s.result) === v} onChange={() => setSpot({ ...spot, [s.id]: v })} /> {v}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <Btn variant="primary" onClick={async () => (await api("/api/evals/spotcheck", { json: { runId: fab.id, results: spot } }), load())}>
            Save spot check
          </Btn>
        </Card>
      )}

      {res("email_intent") && (
        <Card title="Email intent fixtures">
          <table className="w-full text-sm">
            <tbody>
              {res("email_intent").rows.map((r: any) => (
                <tr key={r.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className={`py-1 pr-2 ${r.ok ? "text-emerald-700" : "text-red-700"}`}>{r.ok ? "✓" : "✗"}</td>
                  <td className="pr-2">{r.text}</td>
                  <td className="pr-2 text-xs">expect {r.expect}</td>
                  <td className="text-xs">
                    got {r.got}
                    {r.slot ? ` #${r.slot}` : ""}
                    {r.proposed ? ` ${r.proposed}` : ""}
                    {r.injection ? " ⚠ injection ignored" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card title="Loop proof and time">
        <p className="text-sm">
          Agreement with the fund: cold {d.loop.cold ? `${d.loop.cold.agree}/${d.loop.cold.of}` : "–"} → warm {d.loop.warm ? `${d.loop.warm.agree}/${d.loop.warm.of}` : "–"}
        </p>
        {Object.entries(d.loop.editDistance).map(([t, v]: [string, any]) => (
          <p key={t} className="text-sm">
            Riya&apos;s edits ({t}): first half {v.first ?? "–"} → later {v.later ?? "–"} words (n={v.n})
          </p>
        ))}
        <p className="mt-2 text-sm">
          Time: ~{d.time.riyaBeforeMinutes} min of Riya per application before → ~{d.time.avgMachineMinutes} min unattended machine time + ~{d.time.riyaAfterMinutesEstimate} min review (estimate).
        </p>
      </Card>
    </div>
  );
}
