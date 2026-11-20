import { z } from "zod";
import { recordDecision } from "@/lib/memory";
import "@/lib/steps";

const Body = z.object({
  kind: z.enum(["accept", "override"]),
  finalCall: z.enum(["take_call", "hold", "pass"]),
  criterionChanges: z.array(z.object({ criterion: z.string(), old: z.number().int(), new: z.number().int().min(1).max(5) })).default([]),
  reason: z.string().max(400).optional(),
  decidedBy: z.enum(["kushal", "riya", "aditya"]).default("kushal"),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const p = Body.safeParse(await req.json());
  if (!p.success) return Response.json({ ok: false, error: z.prettifyError(p.error) }, { status: 400 });
  if (p.data.kind === "override" && !p.data.reason?.trim()) return Response.json({ ok: false, error: "An override needs a one-line reason." }, { status: 400 });
  if (p.data.kind === "override" && !p.data.criterionChanges.length && !p.data.reason) return Response.json({ ok: false, error: "Change at least one criterion score or the final call, with a reason." }, { status: 400 });
  try {
    return Response.json({ ok: true, ...(await recordDecision({ appId: id, ...p.data })) });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
