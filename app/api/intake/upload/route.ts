import { createApplications } from "@/lib/intake";
import { audit } from "@/lib/audit";

export const maxDuration = 60;

/** Batch upload: multipart form with files[]; forms and decks are auto-paired by company name. */
export async function POST(req: Request) {
  try {
    const fd = await req.formData();
    const files = fd.getAll("files").filter((f): f is File => typeof f === "object" && "arrayBuffer" in f);
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name));
    if (!pdfs.length) return Response.json({ ok: false, error: "No PDF files received" }, { status: 400 });
    if (pdfs.some((f) => f.size > 8 * 1024 * 1024)) return Response.json({ ok: false, error: "Each PDF must be under 8 MB" }, { status: 400 });
    const uploads = await Promise.all(pdfs.map(async (f) => ({ name: f.name, data: Buffer.from(await f.arrayBuffer()) })));
    const r = await createApplications(uploads, `upload-${new Date().toISOString().slice(0, 16)}`);
    await audit("riya", "intake:upload", { files: pdfs.length, created: r.created.length });
    return Response.json({ ok: true, ...r });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
