import { z } from "zod";
import { approveAndSend } from "@/lib/drafts";
import { resumeThreadAfterRiya } from "@/lib/scheduler-agent";

export const maxDuration = 60;

/** Riya's edit gate: approve (possibly edited) text, record Loop 2 memory, send via Gmail. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = z.object({ final: z.string().min(10), subject: z.string().optional(), by: z.enum(["riya", "kushal"]).default("riya") }).safeParse(await req.json());
  if (!p.success) return Response.json({ ok: false, error: "final text required" }, { status: 400 });
  try {
    const id = Number((await ctx.params).id);
    const r = await approveAndSend(id, p.data.final, p.data.by, p.data.subject);
    await resumeThreadAfterRiya(id);
    return Response.json({ ok: true, ...r });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
