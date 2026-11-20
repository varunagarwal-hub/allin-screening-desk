import { z } from "zod";
import { reviewCalibration } from "@/lib/memory";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = z.object({ approve: z.boolean(), by: z.enum(["kushal", "riya", "aditya"]).default("kushal") }).safeParse(await req.json());
  if (!p.success) return Response.json({ ok: false, error: "approve (boolean) required" }, { status: 400 });
  await reviewCalibration(Number((await ctx.params).id), p.data.approve, p.data.by);
  return Response.json({ ok: true });
}
