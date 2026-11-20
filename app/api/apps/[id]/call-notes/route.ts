import { z } from "zod";
import { addCallNotes } from "@/lib/callnotes";
import "@/lib/steps";

export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = z.object({ author: z.enum(["kushal", "riya", "aditya"]), notes: z.string().min(10).max(4000) }).safeParse(await req.json());
  if (!p.success) return Response.json({ ok: false, error: "author and notes (10+ chars) required" }, { status: 400 });
  try {
    return Response.json({ ok: true, ...(await addCallNotes(Number((await ctx.params).id), p.data.author, p.data.notes)) });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
