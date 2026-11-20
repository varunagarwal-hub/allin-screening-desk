import { NextRequest } from "next/server";
import { checkReplies } from "@/lib/scheduler-agent";

export const maxDuration = 60;

/** Vercel Cron entry point, secured with CRON_SECRET (Hobby: at most daily; the button is the main trigger). */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    return Response.json({ ok: true, ...(await checkReplies("cron")) });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
