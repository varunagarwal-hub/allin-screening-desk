import { loadSeedApplications } from "@/lib/intake";
import { audit } from "@/lib/audit";

export const maxDuration = 60;

/** "Run now": load the 10 seed applications from data/seed. */
export async function POST() {
  try {
    const r = await loadSeedApplications();
    await audit("riya", "intake:seed", { created: r.created.length });
    return Response.json({ ok: true, ...r });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
