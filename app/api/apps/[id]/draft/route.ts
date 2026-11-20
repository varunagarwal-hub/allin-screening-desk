import { draftOutreach } from "@/lib/drafts";

export const maxDuration = 60;

/** Draft the first outreach (invite / deeptech invite / pass note) after Kushal's decision. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    return Response.json({ ok: true, draft: await draftOutreach(Number((await ctx.params).id)) });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
