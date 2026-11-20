import { applicationDetail } from "@/lib/views";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const d = await applicationDetail(Number((await ctx.params).id));
  return d ? Response.json(d) : Response.json({ error: "not found" }, { status: 404 });
}
