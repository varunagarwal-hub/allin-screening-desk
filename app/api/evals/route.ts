import { latestRuns, loopProof, thresholds, thresholdsLock, timeStats } from "@/lib/evals";

export async function GET() {
  const [lock, runs, loop, time] = await Promise.all([thresholdsLock(), latestRuns(), loopProof(), timeStats()]);
  return Response.json({ thresholds, lock, runs, loop, time });
}
