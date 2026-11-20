import { NextRequest } from "next/server";
import { claimsSourcedCheck, computeBacktest, doubleBookingEval, emailIntentEval, fabricationCheck, judgeDisagreements } from "@/lib/evals";
import "@/lib/steps";

export const maxDuration = 60;

/** Quick evals that fit in one request. Backtest scoring and stability runs are long: use scripts/evals.ts. */
export async function POST(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind");
  try {
    const fn: Record<string, () => Promise<unknown>> = {
      claims: claimsSourcedCheck,
      fabrication: fabricationCheck,
      email: emailIntentEval,
      booking: doubleBookingEval,
      backtest_compute: () => computeBacktest(`recompute ${new Date().toISOString().slice(0, 16)}`),
      judge: () => judgeDisagreements(),
    };
    if (!kind || !fn[kind]) return Response.json({ ok: false, error: `kind must be one of ${Object.keys(fn).join(", ")}` }, { status: 400 });
    return Response.json({ ok: true, result: await fn[kind]() });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
