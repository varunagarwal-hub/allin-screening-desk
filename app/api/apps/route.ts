import { NextRequest } from "next/server";
import { listApplications } from "@/lib/views";

export async function GET(req: NextRequest) {
  const backtest = req.nextUrl.searchParams.get("backtest") === "1";
  return Response.json(await listApplications({ backtest }));
}
