import { checkReplies } from "@/lib/scheduler-agent";

export const maxDuration = 60;

/** "Check replies" button: the main trigger for the demo. */
export async function POST() {
  try {
    return Response.json({ ok: true, ...(await checkReplies("riya")) });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
