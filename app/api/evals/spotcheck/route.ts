import { z } from "zod";
import { recordSpotCheck } from "@/lib/evals";

export async function POST(req: Request) {
  const p = z.object({ runId: z.number().int(), results: z.record(z.string(), z.enum(["ok", "fail"])) }).safeParse(await req.json());
  if (!p.success) return Response.json({ ok: false }, { status: 400 });
  const results = Object.fromEntries(Object.entries(p.data.results).map(([k, v]) => [Number(k), v]));
  return Response.json({ ok: true, result: await recordSpotCheck(p.data.runId, results) });
}
