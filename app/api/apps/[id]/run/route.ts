import { NextRequest } from "next/server";
import { runStep, STEPS, type Step } from "@/lib/pipeline";
import "@/lib/steps";

export const maxDuration = 60;

/** One pipeline step for one application per request (Vercel timeout + free-tier friendly). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const step = req.nextUrl.searchParams.get("step") as Step;
  if (!STEPS.includes(step)) return Response.json({ ok: false, error: `step must be one of ${STEPS.join(", ")}` }, { status: 400 });
  const bypass = req.nextUrl.searchParams.get("fresh") === "1";
  return Response.json(await runStep(id, step, { bypassCache: bypass }));
}
