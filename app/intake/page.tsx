"use client";

import Link from "next/link";
import { useState } from "react";
import { api, Btn, Card } from "../_components/ui";

type Result = { ok: boolean; error?: string; created?: Array<{ id: number; company: string; hasForm: boolean; hasDeck: boolean; existed: boolean }>; skipped?: string[] };

export default function Intake() {
  const [files, setFiles] = useState<File[]>([]);
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  // client-side preview of the pairing (same rule as the server)
  const pairs = new Map<string, { form?: string; deck?: string; other: string[] }>();
  for (const f of files) {
    const base = f.name.replace(/\.pdf$/i, "").replace(/^application_\d+_/i, "");
    const m = base.match(/^(.*?)[\s_-]+(form|deck)\b/i);
    const company = (m ? m[1] : base).replace(/[_-]+/g, " ").trim();
    const k = company.toLowerCase().replace(/\s+/g, "");
    const p = pairs.get(k) ?? { other: [] };
    if (m?.[2].toLowerCase() === "form") p.form = f.name;
    else if (m?.[2].toLowerCase() === "deck") p.deck = f.name;
    else p.other.push(f.name);
    pairs.set(k, p);
  }

  async function upload() {
    setBusy(true);
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    setRes(await api<Result>("/api/intake/upload", { method: "POST", body: fd }));
    setBusy(false);
  }
  async function runSeed() {
    setBusy(true);
    setRes(await api<Result>("/api/intake/seed", { method: "POST" }));
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Intake</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Upload a batch">
          <p className="mb-3 text-sm text-zinc-500">
            Drop each applicant&apos;s form and deck PDFs. Files are paired by company name (<code>Company_Form.pdf</code> + <code>Company_Deck.pdf</code>).
          </p>
          <input type="file" accept="application/pdf" multiple onChange={(e) => setFiles([...(e.target.files ?? [])])} className="block w-full text-sm" />
          {files.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {[...pairs.entries()].map(([k, p]) => (
                <li key={k} className={p.form && p.deck ? "" : "text-amber-700"}>
                  <b>{k}</b>: {p.form ? "form ✓" : "form missing"} · {p.deck ? "deck ✓" : "deck missing"}
                  {p.other.length ? ` · unpaired: ${p.other.join(", ")}` : ""}
                </li>
              ))}
            </ul>
          )}
          <Btn variant="primary" className="mt-3" disabled={!files.length || busy} onClick={upload}>
            {busy ? "Uploading…" : `Upload ${files.length || ""} files`}
          </Btn>
        </Card>
        <Card title="Seed batch">
          <p className="mb-3 text-sm text-zinc-500">Load the 10 case applications from <code>data/seed/</code> (StockSathi, EarnWise, Talkbook, Settlr, CareCorner, Yatrika, RentRoute, CAPilot, GrainKind, Pumpwise).</p>
          <Btn variant="primary" disabled={busy} onClick={runSeed}>
            Run now
          </Btn>
        </Card>
      </div>
      {res && (
        <Card title="Result">
          {!res.ok ? (
            <p className="text-sm text-red-600">{res.error}</p>
          ) : (
            <>
              <ul className="space-y-1 text-sm">
                {res.created?.map((c) => (
                  <li key={c.id}>
                    <Link className="underline" href={`/apps/${c.id}`}>
                      {c.company}
                    </Link>{" "}
                    {c.existed ? "(already loaded)" : "(new)"} · form {c.hasForm ? "✓" : "✗"} · deck {c.hasDeck ? "✓" : "✗"}
                  </li>
                ))}
              </ul>
              {!!res.skipped?.length && <p className="mt-2 text-sm text-amber-700">Unpaired files skipped: {res.skipped.join(", ")}</p>}
              <Link href="/" className="mt-3 inline-block">
                <Btn variant="primary">Go to batch and run the pipeline →</Btn>
              </Link>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
