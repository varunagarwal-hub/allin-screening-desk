"use client";
import type { ReactNode } from "react";

export const CRITERIA_LABELS: Record<string, string> = {
  thesis_fit: "Thesis fit",
  stage_cheque_fit: "Stage & cheque",
  founder_quality: "Founder quality",
  path_to_market: "Path to market",
  traction_quality: "Traction quality",
  market_competition: "Market & competition",
  risk_ownership: "Risk ownership",
};
export const CRITERIA_ORDER = Object.keys(CRITERIA_LABELS);

const REC: Record<string, { label: string; cls: string }> = {
  take_call: { label: "Take the call", cls: "bg-emerald-100 text-emerald-800 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800" },
  hold: { label: "Hold", cls: "bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800" },
  pass: { label: "Pass", cls: "bg-zinc-200 text-zinc-700 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700" },
};
export function RecPill({ rec }: { rec: string | null }) {
  if (!rec) return <span className="rounded px-2 py-0.5 text-xs text-zinc-400 ring-1 ring-zinc-200 dark:ring-zinc-800">not scored</span>;
  const r = REC[rec];
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ring-1 ${r.cls}`}>{r.label}</span>;
}

const SEV: Record<string, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  info: "bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
};
export const FLAG_LABELS: Record<string, string> = {
  portfolio_conflict: "Portfolio conflict",
  stage_cheque: "Stage / cheque",
  outside_thesis: "Outside written thesis",
  sector_mislabel: "Sector mislabel",
  missing_numbers: "Missing number",
  form_deck_conflict: "Form ≠ deck",
  deeptech_routing: "Deeptech → Aditya",
  source: "Source",
};
export function FlagBadge({ code, severity, title }: { code: string; severity: string; title?: string }) {
  return (
    <span title={title} className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${SEV[severity] ?? SEV.low}`}>
      {FLAG_LABELS[code] ?? code}
    </span>
  );
}

export function ScoreDots({ score, prev }: { score?: number; prev?: number }) {
  if (score == null) return <span className="text-zinc-400">–</span>;
  return (
    <span className="inline-flex items-center gap-1" title={`${score}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`h-2 w-2 rounded-full ${i <= score ? (score >= 4 ? "bg-emerald-500" : score === 3 ? "bg-amber-500" : "bg-red-500") : "bg-zinc-200 dark:bg-zinc-700"}`} />
      ))}
      <span className="ml-1 text-xs tabular-nums text-zinc-500">{score}</span>
      {prev != null && prev !== score && <span className="text-[11px] text-violet-600">(was {prev})</span>}
    </span>
  );
}

export function Card({ title, children, right }: { title?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Btn(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const { variant = "ghost", className = "", ...rest } = props;
  const v =
    variant === "primary"
      ? "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      : variant === "danger"
        ? "bg-red-600 text-white hover:bg-red-500"
        : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";
  return <button {...rest} className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${v} ${className}`} />;
}

export function SourceRef({ source }: { source: { file?: string; page?: number | null; type?: string; url?: string | null } | null | undefined }) {
  if (!source) return <span className="text-xs text-zinc-400">no source</span>;
  if (source.url)
    return (
      <a href={source.url} target="_blank" rel="noreferrer" className="text-xs text-sky-700 underline dark:text-sky-400">
        {(() => {
          try {
            return new URL(source.url).hostname.replace(/^www\./, "");
          } catch {
            return source.url;
          }
        })()}
      </a>
    );
  const f = source.file ?? source.type;
  return <span className="text-xs text-zinc-500">{f}{source.page ? ` p${source.page}` : ""}</span>;
}

export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    method: init?.method ?? (init?.json ? "POST" : "GET"),
    headers: init?.json ? { "Content-Type": "application/json" } : init?.headers,
    body: init?.json ? JSON.stringify(init.json) : init?.body,
    cache: "no-store",
  });
  return (await res.json()) as T;
}
