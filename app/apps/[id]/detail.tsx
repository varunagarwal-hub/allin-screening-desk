"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, Btn, Card, CRITERIA_LABELS, CRITERIA_ORDER, FlagBadge, RecPill, ScoreDots, SourceRef } from "../../_components/ui";
import { OutreachPanel } from "../../_components/outreach-panel";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Detail = any;

export function AppDetail() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [tab, setTab] = useState<"scores" | "founder" | "research" | "facts">("scores");
  const load = useCallback(async () => setD(await api(`/api/apps/${id}`)), [id]);
  useEffect(() => {
    load();
  }, [load]);
  if (!d) return <p className="text-sm text-zinc-500">Loading…</p>;
  if (d.error) return <p className="text-sm text-red-600">{d.error}</p>;

  const rec = d.recommendation;
  const prev = Object.fromEntries((d.previousScores ?? []).map((s: any) => [s.criterion, s.score]));
  const sc = Object.fromEntries(d.scores.map((s: any) => [s.criterion, s]));
  const failed = d.steps.filter((s: any) => s.status === "failed");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/" className="text-sm text-zinc-500 hover:underline">
            ← Batch
          </Link>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
            {d.app.company} <RecPill rec={rec?.recommendation ?? null} />
            {d.app.isDeeptech && <FlagBadge code="deeptech_routing" severity="info" />}
          </h1>
          <p className="text-sm text-zinc-500">
            {[d.app.sector, d.app.businessModel].filter(Boolean).join(" · ")} · status {d.app.status}
          </p>
        </div>
        <RescoreButton id={id} onDone={load} />
      </div>

      {failed.length > 0 && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {failed.map((s: any) => (
            <div key={s.step}>
              Step <b>{s.step}</b> failed: {s.error}
            </div>
          ))}
        </div>
      )}

      {rec && (
        <Card title="The read">
          <p className="whitespace-pre-line text-base leading-relaxed">{rec.partnerSummary}</p>
          <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase text-zinc-500">Which thesis drove it</div>
              <p>
                <b>{rec.drivenBy}</b>: {rec.drivenByWhy}
              </p>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-zinc-500">What would change our view</div>
              <p>{rec.whatWouldChange}</p>
            </div>
          </div>
          {rec.memoryUsed?.memory?.length > 0 && (
            <p className="mt-3 rounded bg-violet-50 p-2 text-xs text-violet-900 dark:bg-violet-950 dark:text-violet-200">
              Past corrections in context: {rec.memoryUsed.memory.map((m: any) => `${m.ref} (${m.company})`).join(", ")}
              {rec.memoryUsed.calibration?.length ? ` · calibration notes: ${rec.memoryUsed.calibration.map((c: any) => c.ref).join(", ")}` : ""}
            </p>
          )}
          {d.previousRecommendation && d.previousRecommendation.recommendation !== rec.recommendation && (
            <p className="mt-2 text-xs text-violet-700">Re-score changed the call: {d.previousRecommendation.recommendation} → {rec.recommendation}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-1">
            {d.flags
              .filter((f: any) => f.severity !== "info")
              .map((f: any) => (
                <FlagBadge key={f.id} code={f.code} severity={f.severity} title={f.reason} />
              ))}
          </div>
          {rec.callQuestions?.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-semibold uppercase text-zinc-500">Questions for the call</div>
              <ol className="ml-5 list-decimal text-sm">
                {rec.callQuestions.map((q: string, i: number) => (
                  <li key={i}>{q}</li>
                ))}
              </ol>
            </div>
          )}
        </Card>
      )}

      {rec && <DecisionPanel d={d} onDone={load} />}

      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {(["scores", "founder", "research", "facts"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-sm ${tab === t ? "border-b-2 border-zinc-900 font-semibold dark:border-white" : "text-zinc-500"}`}>
            {{ scores: "Scores & evidence", founder: "Founder file", research: "Research & claims", facts: "Flags & extraction" }[t]}
          </button>
        ))}
      </div>

      {tab === "scores" && (
        <Card>
          {!d.scores.length ? (
            <p className="text-sm text-zinc-500">Not scored yet.</p>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {CRITERIA_ORDER.map((k) => {
                const s = sc[k];
                if (!s) return null;
                const rationale = s.evidence.find((e: any) => e.rationale)?.rationale;
                const ev = s.evidence.filter((e: any) => !e.rationale);
                return (
                  <details key={k} className="py-2">
                    <summary className="flex cursor-pointer flex-wrap items-center gap-3">
                      <span className="w-44 font-medium">{CRITERIA_LABELS[k]}</span>
                      <ScoreDots score={s.score} prev={prev[k]} />
                      <span className="text-xs text-zinc-500">
                        vs {s.thesisBasis} thesis · conf {Math.round((s.confidence ?? 0) * 100)}%
                      </span>
                      {s.missing?.length > 0 && <span className="text-xs text-amber-700">−{s.missing.reduce((a: number, m: any) => a + m.penalty, 0)} for gaps</span>}
                      {s.memoryInfluence?.length > 0 && <span className="text-xs text-violet-700">influenced by past correction</span>}
                    </summary>
                    <div className="mt-2 space-y-2 pl-2 text-sm">
                      {rationale && <p>{rationale}</p>}
                      {ev.length > 0 && (
                        <ul className="ml-4 list-disc text-zinc-700 dark:text-zinc-300">
                          {ev.map((e: any, i: number) => (
                            <li key={i}>
                              {e.note} <span className="text-xs text-zinc-500">[{e.claim_id ? `claim #${e.claim_id}` : e.ref}]</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {s.missing?.length > 0 && (
                        <div className="text-amber-800 dark:text-amber-300">
                          Missing: {s.missing.map((m: any) => `${m.item} (−${m.penalty})`).join("; ")}
                        </div>
                      )}
                      {s.memoryInfluence?.length > 0 && (
                        <div className="rounded bg-violet-50 p-2 text-violet-900 dark:bg-violet-950 dark:text-violet-200">
                          {s.memoryInfluence.map((m: any, i: number) => (
                            <div key={i}>
                              <b>{m.ref}</b>: {m.effect}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {tab === "founder" && <FounderTab ff={d.founderFile} />}
      {tab === "research" && <ResearchTab research={d.research} claims={d.claims} />}
      {tab === "facts" && <FactsTab d={d} />}

      <CallNotes id={id} notes={d.callNotes} onDone={load} />
      <OutreachPanel appId={Number(id)} detail={d} onChange={load} />
    </div>
  );
}

function RescoreButton({ id, onDone }: { id: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Btn
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await api(`/api/apps/${id}/run?step=score&fresh=1`, { method: "POST" });
        setBusy(false);
        onDone();
      }}
      title="Re-run the scorer with current memory and calibration notes (Loop 1 carry-over)"
    >
      {busy ? "Re-scoring…" : "Re-score"}
    </Btn>
  );
}

function DecisionPanel({ d, onDone }: { d: Detail; onDone: () => void }) {
  const rec = d.recommendation;
  const [mode, setMode] = useState<"none" | "accept" | "override">("none");
  const [finalCall, setFinalCall] = useState(rec.recommendation);
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const last = d.decisions[0];
  const submit = async () => {
    const criterionChanges = Object.entries(edits)
      .map(([criterion, n]) => ({ criterion, old: d.scores.find((s: any) => s.criterion === criterion)?.score, new: n }))
      .filter((c) => c.old != null && c.old !== c.new);
    const r = await api<{ ok: boolean; error?: string; lesson?: string; proposal?: any }>(`/api/apps/${d.app.id}/decision`, {
      json: { kind: mode, finalCall: mode === "accept" ? rec.recommendation : finalCall, criterionChanges: mode === "accept" ? [] : criterionChanges, reason: reason || undefined, decidedBy: "kushal" },
    });
    if (!r.ok) return setMsg(r.error ?? "failed");
    setMsg(`Saved. Memory: “${r.lesson}”${r.proposal?.proposed ? ` · ${r.proposal.proposed} calibration note(s) proposed, see Calibration` : ""}`);
    setMode("none");
    onDone();
  };
  return (
    <Card title="Kushal's decision" right={last && <span className="text-xs text-zinc-500">last: {last.kind} → {last.finalCall} by {last.decidedBy}{last.reason ? ` (“${last.reason}”)` : ""}</span>}>
      {mode === "none" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Btn variant="primary" onClick={() => setMode("accept")}>
            Accept: {rec.recommendation.replace("_", " ")}
          </Btn>
          <Btn onClick={() => setMode("override")}>Override…</Btn>
          <span className="text-xs text-zinc-500">Nothing is sent or decided until you act here.</span>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          {mode === "override" && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                Final call:
                {["take_call", "hold", "pass"].map((c) => (
                  <label key={c} className="flex items-center gap-1">
                    <input type="radio" checked={finalCall === c} onChange={() => setFinalCall(c)} /> {c.replace("_", " ")}
                  </label>
                ))}
              </div>
              <div className="grid gap-1 md:grid-cols-2">
                {d.scores.map((s: any) => (
                  <label key={s.criterion} className="flex items-center justify-between gap-2">
                    <span>{CRITERIA_LABELS[s.criterion]}</span>
                    <select className="rounded border border-zinc-300 bg-transparent px-1 dark:border-zinc-700" value={edits[s.criterion] ?? s.score} onChange={(e) => setEdits({ ...edits, [s.criterion]: Number(e.target.value) })}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n}
                          {n === s.score ? " (system)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </>
          )}
          <input
            className="w-full rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700"
            placeholder={mode === "override" ? "One-line reason (required, reused for similar companies)" : "Optional reason"}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Btn variant="primary" onClick={submit} disabled={mode === "override" && !reason.trim()}>
              Save {mode}
            </Btn>
            <Btn onClick={() => setMode("none")}>Cancel</Btn>
          </div>
        </div>
      )}
      {msg && <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{msg}</p>}
    </Card>
  );
}

const SIG_LABEL: Record<string, string> = {
  owns_risk: "Owns the risk",
  cohorts_margins: "Thinks in cohorts & margins",
  field_groundwork: "Field groundwork first",
  names_failures: "Names failures candidly",
  milestone_sequence: "Milestone plan for regulation",
  founder_market_fit: "Founder-market fit",
  pushes_risk: "Pushes risk onto partners",
  defensive: "Defensive on weak spots",
  growth_bought: "Growth bought, not earned",
  regulatory_bet: "Bets on friendlier regulation",
};
function FounderTab({ ff }: { ff: any }) {
  if (!ff) return <Card><p className="text-sm text-zinc-500">Founder file not built yet.</p></Card>;
  const meta = ff.calibrationMemos ?? {};
  const color = (s: any) => {
    const pen = ["pushes_risk", "defensive", "growth_bought", "regulatory_bet"].includes(s.signal);
    if (s.state === "present") return pen ? "text-red-700" : "text-emerald-700";
    if (s.state === "absent") return pen ? "text-emerald-700" : "text-amber-700";
    return "text-zinc-500";
  };
  return (
    <Card title={`Founder file v${ff.version} · confidence ${Math.round((ff.confidence ?? 0) * 100)}% · public trace: ${meta.public_trace ?? "?"}`}>
      <p className="mb-3 text-sm">{ff.founderMarketFit}</p>
      <table className="w-full text-sm">
        <tbody>
          {ff.signals.map((s: any) => (
            <tr key={s.signal} className="border-t border-zinc-100 align-top dark:border-zinc-800">
              <td className="w-56 py-1.5 font-medium">{SIG_LABEL[s.signal] ?? s.signal}</td>
              <td className={`w-28 py-1.5 ${color(s)}`}>
                {s.state}
                {s.call_only && <div className="text-[11px] text-sky-700">judge on call</div>}
              </td>
              <td className="py-1.5">
                {s.evidence} <SourceRef source={s.source} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {meta.team_facts?.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase text-zinc-500">Team facts</div>
          <ul className="ml-4 list-disc text-sm">
            {meta.team_facts.map((t: any, i: number) => (
              <li key={i} className={t.flag ? "text-red-700" : ""}>
                {t.fact} <SourceRef source={t.source} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {ff.redFlags?.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase text-zinc-500">Red flags</div>
          <ul className="ml-4 list-disc text-sm text-red-800 dark:text-red-300">
            {ff.redFlags.map((r: any, i: number) => (
              <li key={i}>
                {r.flag} <SourceRef source={r.source} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3">
        <div className="text-xs font-semibold uppercase text-zinc-500">Call questions</div>
        <ol className="ml-5 list-decimal text-sm">
          {ff.callQuestions.map((q: string, i: number) => (
            <li key={i}>{q}</li>
          ))}
        </ol>
      </div>
      {meta.retrieved && <p className="mt-3 text-xs text-zinc-500">Calibrated against: {meta.retrieved.map((m: any) => `${m.company} (${m.decision})`).join(", ")}</p>}
    </Card>
  );
}

const STATUS_CLS: Record<string, string> = {
  verified: "text-emerald-700",
  contradicted: "text-red-700",
  unverifiable: "text-zinc-500",
  not_found: "text-amber-700",
};
function ResearchTab({ research, claims }: { research: any; claims: any[] }) {
  if (!research) return <Card><p className="text-sm text-zinc-500">Research not run yet.</p></Card>;
  const r = research.report;
  return (
    <div className="space-y-3">
      <Card title={`Research · ${r.sources.length} sources · ${r.tavily_calls} Tavily calls${r.downgraded ? ` · ${r.downgraded} unsupported citations removed` : ""}`}>
        <div className="grid gap-3 text-sm md:grid-cols-2">
          {Object.entries(r.sections ?? {}).map(([k, v]) => (
            <div key={k}>
              <div className="text-xs font-semibold uppercase text-zinc-500">{k}</div>
              <p>{v as string}</p>
            </div>
          ))}
        </div>
        {r.competitors_found?.length > 0 && (
          <p className="mt-3 text-sm">
            <b>Competitors found:</b>{" "}
            {r.competitors_found.map((c: any, i: number) => (
              <span key={i}>
                {i > 0 && ", "}
                <a className="underline" href={c.url} target="_blank" rel="noreferrer">
                  {c.name}
                </a>
              </span>
            ))}
          </p>
        )}
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase text-zinc-500">Could not find</div>
          <ul className="ml-4 list-disc text-sm text-amber-800 dark:text-amber-300">
            {r.could_not_find.map((c: string, i: number) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>
        {r.errors?.length > 0 && <p className="mt-2 text-xs text-red-600">Errors: {r.errors.join("; ")}</p>}
      </Card>
      <Card title={`Claim check (${claims.length})`}>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-zinc-500">
            <tr>
              <th className="py-1">#</th>
              <th>Claim</th>
              <th>Status</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {claims.map((c) => (
              <tr key={c.id} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                <td className="py-1.5 text-xs text-zinc-400">{c.id}</td>
                <td className="py-1.5">
                  {c.text}
                  <div className="text-xs text-zinc-500">
                    {c.category} · from {c.claimOrigin}
                    {c.excerpt && <> · “{c.excerpt}”</>}
                  </div>
                </td>
                <td className={`py-1.5 ${STATUS_CLS[c.status]}`}>
                  {c.status}
                  <div className="text-xs text-zinc-400">{Math.round((c.confidence ?? 0) * 100)}%</div>
                </td>
                <td className="py-1.5">
                  {c.sourceUrl ? (
                    <>
                      <SourceRef source={{ url: c.sourceUrl }} />
                      <div className="text-[11px] text-zinc-400">tier {c.sourceTier} · {c.fetchedAt?.slice(0, 10)}</div>
                    </>
                  ) : (
                    <SourceRef source={{ file: c.sourceFile, page: c.sourcePage }} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="All sources retrieved in this run">
        <ul className="space-y-1 text-sm">
          {r.sources.map((s: any) => (
            <li key={s.id}>
              <span className="text-xs text-zinc-400">{s.id} · {s.section} · tier {s.tier} · {s.via}</span>{" "}
              <a className="underline" href={s.url} target="_blank" rel="noreferrer">
                {s.title || s.url}
              </a>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function FactsTab({ d }: { d: Detail }) {
  const x = d.extraction?.data;
  return (
    <div className="space-y-3">
      <Card title="Rule-check flags">
        <ul className="space-y-1.5 text-sm">
          {d.flags.map((f: any) => (
            <li key={f.id} className="flex gap-2">
              <FlagBadge code={f.code} severity={f.severity} />
              <span>{f.reason}</span>
            </li>
          ))}
        </ul>
      </Card>
      {x && (
        <Card title="Extraction (form + deck)">
          {d.extraction.conflicts?.length > 0 && (
            <div className="mb-3 rounded bg-amber-50 p-2 text-sm dark:bg-amber-950">
              <b>Form vs deck conflicts</b>
              <ul className="ml-4 list-disc">
                {d.extraction.conflicts.map((c: any, i: number) => (
                  <li key={i}>
                    [{c.severity}] {c.field}: form “{c.form_says}” vs deck “{c.deck_says}”
                  </li>
                ))}
              </ul>
            </div>
          )}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm md:grid-cols-2">
            {["company", "legal_name", "website", "city", "incorporation_date", "one_liner", "sector_selected", "stage_selected", "raise_inr_cr", "valuation_inr_cr", "equity_split", "team_composition", "outsourced_or_contract_staff", "repeat_retention", "use_of_funds", "existing_investors"].map((k) => (
              <div key={k} className="flex gap-2">
                <dt className="w-44 shrink-0 text-zinc-500">{k.replace(/_/g, " ")}</dt>
                <dd>
                  {x[k]?.value ?? <span className="text-amber-700">not stated</span>} {x[k]?.value != null && <SourceRef source={x[k].source} />}
                </dd>
              </div>
            ))}
            <div className="flex gap-2">
              <dt className="w-44 shrink-0 text-zinc-500">source</dt>
              <dd>
                {x.application_source.kind}
                {x.application_source.from_whom ? `: ${x.application_source.from_whom}` : ""}
              </dd>
            </div>
          </dl>
          <div className="mt-3 text-sm">
            <b>Founders</b>
            <ul className="ml-4 list-disc">
              {x.founders.map((f: any, i: number) => (
                <li key={i}>
                  {f.name} ({f.role}): {f.background} {f.departed ? <span className="text-red-700">· departed: {f.departure_note}</span> : ""} <SourceRef source={f.source} />
                </li>
              ))}
            </ul>
            <b>Traction</b>
            <ul className="ml-4 list-disc">
              {x.traction_metrics.map((t: any, i: number) => (
                <li key={i}>
                  {t.metric}: {t.value} {t.period ? `(${t.period})` : ""} <SourceRef source={t.source} />
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}
    </div>
  );
}

function CallNotes({ id, notes, onDone }: { id: string; notes: any[]; onDone: () => void }) {
  const [text, setText] = useState("");
  const [author, setAuthor] = useState("kushal");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Card title="Call notes">
      {notes.map((n) => (
        <div key={n.id} className="mb-2 rounded bg-zinc-50 p-2 text-sm dark:bg-zinc-800">
          <div className="text-xs text-zinc-500">
            {n.author} · {new Date(n.createdAt).toLocaleString()}
            {n.resultingChanges?.changes?.length ? ` · changed ${n.resultingChanges.changes.map((c: any) => `${c.criterion} ${c.old}→${c.new}`).join(", ")}` : ""}
          </div>
          {n.notes}
        </div>
      ))}
      <textarea className="w-full rounded border border-zinc-300 bg-transparent p-2 text-sm dark:border-zinc-700" rows={3} placeholder="After the call: what did you learn? (updates the founder file and founder score; any change is stored as a correction)" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-2 flex items-center gap-2">
        <select className="rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700" value={author} onChange={(e) => setAuthor(e.target.value)}>
          <option value="kushal">Kushal</option>
          <option value="riya">Riya</option>
          <option value="aditya">Aditya</option>
        </select>
        <Btn
          variant="primary"
          disabled={busy || text.length < 10}
          onClick={async () => {
            setBusy(true);
            const r = await api<any>(`/api/apps/${id}/call-notes`, { json: { author, notes: text } });
            setBusy(false);
            setMsg(r.ok ? `Updated. ${r.changes.length ? `Changed: ${r.changes.map((c: any) => `${c.criterion} ${c.old}→${c.new}`).join(", ")}` : "No score changes."} Recommendation: ${r.recommendation}` : r.error);
            setText("");
            onDone();
          }}
        >
          {busy ? "Updating founder file and score…" : "Add notes"}
        </Btn>
        {msg && <span className="text-xs text-zinc-600">{msg}</span>}
      </div>
    </Card>
  );
}
