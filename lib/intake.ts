/** Phase 2 intake: store PDFs, auto-pair form + deck by company name, create applications. */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { applications, files } from "./schema";
import { sha256 } from "./cache";
import { pdfText } from "./pdf";

export type Upload = { name: string; data: Buffer };

/** "StockSathi_Form Response.pdf" -> { company: "StockSathi", kind: "form" } */
export function classifyFile(name: string): { company: string; kind: "form" | "deck" | "other" } {
  const base = name.replace(/\.pdf$/i, "").replace(/^application_\d+_/i, "");
  const m = base.match(/^(.*?)[\s_-]+(form|deck)\b/i);
  if (!m) return { company: base.trim(), kind: "other" };
  return { company: m[1].replace(/[_-]+/g, " ").trim(), kind: m[2].toLowerCase() as "form" | "deck" };
}

/** Group uploads into {company, form?, deck?} pairs; case-insensitive company match. */
export function pairUploads<T extends { name: string }>(uploads: T[]) {
  const groups = new Map<string, { company: string; form?: T; deck?: T; other: T[] }>();
  for (const u of uploads) {
    const c = classifyFile(u.name);
    const key = c.company.toLowerCase().replace(/\s+/g, "");
    const g = groups.get(key) ?? { company: c.company, other: [] };
    if (c.kind === "form") g.form = u;
    else if (c.kind === "deck") g.deck = u;
    else g.other.push(u);
    groups.set(key, g);
  }
  return [...groups.values()];
}

export async function storeFile(u: Upload): Promise<number> {
  const sha = sha256(u.data);
  const [existing] = await db().select({ id: files.id }).from(files).where(eq(files.sha, sha));
  if (existing) return existing.id;
  let text: string | null = null;
  let pages: number | null = null;
  try {
    const t = await pdfText(u.data);
    text = t.text;
    pages = t.pages;
  } catch {
    /* text is only needed for the Groq fallback */
  }
  const [row] = await db()
    .insert(files)
    .values({ name: u.name, sha, sizeBytes: u.data.length, dataB64: u.data.toString("base64"), text, pages })
    .returning({ id: files.id });
  return row.id;
}

export async function createApplications(uploads: Upload[], batchId: string) {
  const pairs = pairUploads(uploads);
  const created: Array<{ id: number; company: string; hasForm: boolean; hasDeck: boolean; existed: boolean }> = [];
  const skipped: string[] = [];
  for (const p of pairs) {
    if (!p.form && !p.deck) {
      skipped.push(...p.other.map((o) => o.name));
      continue;
    }
    const formFileId = p.form ? await storeFile(p.form) : null;
    const deckFileId = p.deck ? await storeFile(p.deck) : null;
    const [dupe] = await db()
      .select({ id: applications.id })
      .from(applications)
      .where(and(eq(applications.company, p.company), eq(applications.isBacktest, false)));
    if (dupe) {
      created.push({ id: dupe.id, company: p.company, hasForm: !!p.form, hasDeck: !!p.deck, existed: true });
      continue;
    }
    const [row] = await db()
      .insert(applications)
      .values({ company: p.company, batchId, formFileId, deckFileId, status: "uploaded" })
      .returning({ id: applications.id });
    created.push({ id: row.id, company: p.company, hasForm: !!p.form, hasDeck: !!p.deck, existed: false });
  }
  return { created, skipped };
}

/** "Run now": load the 10 seed applications from data/seed. */
export async function loadSeedApplications() {
  const dir = path.join(process.cwd(), "data", "seed");
  let uploads: Upload[] = [];
  try {
    const names = (await readdir(dir)).filter((n) => /\.pdf$/i.test(n) && !/^MESA_/i.test(n));
    uploads = await Promise.all(names.map(async (name) => ({ name, data: await readFile(path.join(dir, name)) })));
  } catch {
    /* no local seed folder (e.g. on Vercel, where the case PDFs are not deployed) */
  }
  if (!uploads.length) {
    // fall back to seed PDFs already stored in the database from a local run
    const rows = await db().select().from(files);
    uploads = rows.filter((f) => /_(form|deck)/i.test(f.name)).map((f) => ({ name: f.name, data: Buffer.from(f.dataB64, "base64") }));
    if (!uploads.length) throw new Error("No seed PDFs found: put them in data/seed locally, or upload them on this page.");
  }
  return createApplications(uploads, `seed-${new Date().toISOString().slice(0, 10)}`);
}

export async function loadFile(id: number | null) {
  if (!id) return undefined;
  const [f] = await db().select().from(files).where(eq(files.id, id));
  if (!f) return undefined;
  return { name: f.name, data: Buffer.from(f.dataB64, "base64"), text: f.text ?? undefined };
}
