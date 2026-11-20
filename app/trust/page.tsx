"use client";
import { useEffect, useState } from "react";
import { Btn, Card } from "../_components/ui";

/** Trust report: rendered Markdown with a download link. */
export default function Trust() {
  const [md, setMd] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/evals/report", { cache: "no-store" }).then(async (r) => setMd(await r.text()));
  }, []);
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Trust report</h1>
          <p className="text-sm text-zinc-500">How far Kushal can trust the system, in numbers agreed in advance, and where it breaks.</p>
        </div>
        <a href="/api/evals/report">
          <Btn variant="primary">Export Markdown</Btn>
        </a>
      </div>
      <Card>{md === null ? <p className="text-sm text-zinc-500">Loading…</p> : <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{md}</pre>}</Card>
    </div>
  );
}
