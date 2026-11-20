import { z } from "zod";
import { setAutoHandle } from "@/lib/scheduler-agent";

export async function POST(req: Request) {
  const p = z.object({ autoHandle: z.boolean() }).safeParse(await req.json());
  if (!p.success) return Response.json({ ok: false }, { status: 400 });
  await setAutoHandle(p.data.autoHandle);
  return Response.json({ ok: true });
}
