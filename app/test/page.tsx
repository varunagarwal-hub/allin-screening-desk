"use client";

import { useState } from "react";

const SERVICES = [
  { key: "db", label: "Neon Postgres" },
  { key: "gemini", label: "Gemini" },
  { key: "groq", label: "Groq (fallback)" },
  { key: "tavily", label: "Tavily" },
  { key: "rss", label: "Google News RSS" },
  { key: "jina", label: "Jina Reader" },
  { key: "gmail", label: "Gmail (list labels)" },
  { key: "calendar", label: "Calendar (free/busy)" },
] as const;

type R = { ok: boolean; mode?: string; detail: unknown; ms?: number };

export default function TestPage() {
  const [results, setResults] = useState<Record<string, R | "running">>({});

  async function run(key: string) {
    setResults((r) => ({ ...r, [key]: "running" }));
    try {
      const res = await fetch(`/api/test/${key}`, { cache: "no-store" });
      const body = (await res.json()) as R;
      setResults((r) => ({ ...r, [key]: body }));
    } catch (e) {
      setResults((r) => ({ ...r, [key]: { ok: false, detail: String(e) } }));
    }
  }
  async function runAll() {
    for (const s of SERVICES) await run(s.key); // one at a time (free-tier friendly)
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Connection test</h1>
          <p className="text-sm text-zinc-500">Calls each external service once. Gmail/Calendar show “mock” when Google credentials are not set.</p>
        </div>
        <button onClick={runAll} className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900">
          Run all
        </button>
      </div>
      <ul className="space-y-3">
        {SERVICES.map((s) => {
          const r = results[s.key];
          const badge =
            r === undefined ? (
              <span className="text-zinc-400">not run</span>
            ) : r === "running" ? (
              <span className="text-amber-600">running…</span>
            ) : r.ok ? (
              <span className="text-emerald-600">ok{r.mode ? ` · ${r.mode}` : ""}{r.ms != null ? ` · ${r.ms}ms` : ""}</span>
            ) : (
              <span className="text-red-600">failed</span>
            );
          return (
            <li key={s.key} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="flex items-center justify-between gap-4">
                <div className="font-medium">{s.label}</div>
                <div className="flex items-center gap-3 text-sm">
                  {badge}
                  <button onClick={() => run(s.key)} className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
                    Test
                  </button>
                </div>
              </div>
              {r && r !== "running" && (
                <pre className="mt-3 max-h-64 overflow-auto rounded bg-zinc-50 p-3 text-xs dark:bg-zinc-900">{JSON.stringify(r.detail, null, 2)}</pre>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
