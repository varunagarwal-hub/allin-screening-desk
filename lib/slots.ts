/**
 * Phase 8b: slot holds and booking on top of lib/calendar.ts.
 * - Tue/Thu 14:00-18:00 IST, 30-min, next 2 weeks; Kushal + Aditya (deeptech).
 * - 3 spread-out slots get tentative HOLD events and a slot_holds row (unique on active start = no double offers).
 * - Holds expire after 72h. Booking re-checks free/busy first.
 */
import { and, eq, gt, inArray, lt, or } from "drizzle-orm";
import { db } from "./db";
import { meetings, slotHolds } from "./schema";
import { adityaCalendarId, calendar, candidateSlots, formatIst, freeSlots, isWithinRules, kushalCalendarId, overlaps, pickSpread, type Interval } from "./calendar";
import { audit } from "./audit";

export const HOLD_HOURS = 72;

export function calendarsFor(isDeeptech: boolean) {
  const a = adityaCalendarId();
  return { kushal: kushalCalendarId(), ...(isDeeptech && a ? { aditya: a } : {}) } as Record<string, string>;
}

/** Expire stale holds (and delete their HOLD events). */
export async function expireHolds() {
  const stale = await db().select().from(slotHolds).where(and(eq(slotHolds.status, "held"), lt(slotHolds.expiresAt, new Date())));
  for (const h of stale) await releaseHold(h.id, "expired");
  return stale.length;
}

async function releaseHold(id: number, to: "released" | "expired") {
  const [h] = await db().select().from(slotHolds).where(eq(slotHolds.id, id));
  if (!h || h.status !== "held") return;
  const evts = h.calendarEventIds as Record<string, string>;
  const cals = calendarsFor(true);
  for (const [who, evId] of Object.entries(evts)) await calendar().deleteEvent(cals[who] ?? kushalCalendarId(), evId).catch(() => {});
  await db().update(slotHolds).set({ status: to }).where(eq(slotHolds.id, id));
}

export async function releaseThreadHolds(threadId: number, exceptId?: number) {
  const holds = await db().select().from(slotHolds).where(and(eq(slotHolds.threadId, threadId), eq(slotHolds.status, "held")));
  for (const h of holds) if (h.id !== exceptId) await releaseHold(h.id, "released");
}

/** Busy intervals across the needed calendars, plus slots already held/booked for other founders. */
async function busyFor(isDeeptech: boolean, from: Date, to: Date): Promise<Interval[]> {
  const cals = Object.values(calendarsFor(isDeeptech));
  const fb = await calendar().freeBusy(cals, from, to);
  const busy = Object.values(fb).flat();
  const held = await db().select().from(slotHolds).where(and(inArray(slotHolds.status, ["held", "booked"]), gt(slotHolds.end, from)));
  return [...busy, ...held.map((h) => ({ start: h.start, end: h.end }))];
}

/** Pick 3 spread-out free slots, create tentative HOLD events, store slot_holds. */
export async function offerSlots(p: { appId: number; threadId: number; company: string; isDeeptech: boolean; n?: number; now?: Date }) {
  await expireHolds();
  const now = p.now ?? new Date();
  const cands = candidateSlots(now);
  if (!cands.length) return [];
  const busy = await busyFor(p.isDeeptech, now, cands[cands.length - 1].end);
  const free = freeSlots(cands, busy);
  const picks = pickSpread(free, p.n ?? 3);
  const cals = calendarsFor(p.isDeeptech);
  const out: Array<{ id: number; start: Date; end: Date; label: string }> = [];
  for (const s of picks) {
    // claim the slot in the DB first (unique index); if another founder grabbed it, skip
    let row;
    try {
      [row] = await db()
        .insert(slotHolds)
        .values({ threadId: p.threadId, applicationId: p.appId, start: s.start, end: s.end, status: "held", expiresAt: new Date(now.getTime() + HOLD_HOURS * 3600_000), calendarEventIds: {} })
        .returning();
    } catch {
      continue;
    }
    const ids: Record<string, string> = {};
    for (const [who, calId] of Object.entries(cals)) {
      const e = await calendar().createEvent({ calendarId: calId, summary: `HOLD: ${p.company} intro call (tentative)`, start: s.start, end: s.end, tentative: true });
      ids[who] = e.eventId;
    }
    await db().update(slotHolds).set({ calendarEventIds: ids }).where(eq(slotHolds.id, row.id));
    out.push({ id: row.id, start: s.start, end: s.end, label: formatIst(s.start) });
  }
  await audit("agent", "slots:held", { threadId: p.threadId, slots: out.map((o) => o.label), calendars: Object.keys(cals) }, p.appId);
  return out;
}

export async function activeHolds(threadId: number) {
  return db().select().from(slotHolds).where(and(eq(slotHolds.threadId, threadId), eq(slotHolds.status, "held"))).orderBy(slotHolds.start);
}

/** Is a specific time bookable right now (rules + free on all needed calendars + not held by someone else)? */
export async function isBookable(start: Date, isDeeptech: boolean, threadId: number, now = new Date()) {
  if (!isWithinRules(start, now)) return { ok: false as const, reason: "outside Tue/Thu 14:00-18:00 IST in the next 2 weeks" };
  const end = new Date(start.getTime() + 30 * 60_000);
  const fb = await calendar().freeBusy(Object.values(calendarsFor(isDeeptech)), start, end);
  // ignore our own HOLD events for this thread (they show as busy)
  const own = await db().select().from(slotHolds).where(and(eq(slotHolds.threadId, threadId), eq(slotHolds.status, "held")));
  const ownMatches = (i: Interval) => own.some((h) => h.start.getTime() === i.start.getTime());
  if (Object.values(fb).flat().some((b) => overlaps(b, { start, end }) && !ownMatches(b))) return { ok: false as const, reason: "busy on a partner calendar" };
  const others = await db()
    .select()
    .from(slotHolds)
    .where(and(eq(slotHolds.start, start), inArray(slotHolds.status, ["held", "booked"])));
  if (others.some((h) => h.threadId !== threadId)) return { ok: false as const, reason: "already offered to another founder" };
  return { ok: true as const, end };
}

/** Book: re-check, create the real event with Meet + invites, release other holds, record meeting. */
export async function book(p: { appId: number; threadId: number; company: string; isDeeptech: boolean; start: Date; founderEmail: string; partnerEmails: string[] }) {
  const chk = await isBookable(p.start, p.isDeeptech, p.threadId);
  if (!chk.ok) return { ok: false as const, reason: chk.reason };
  const end = chk.end;
  // claim/convert the slot row
  const [mine] = await db().select().from(slotHolds).where(and(eq(slotHolds.threadId, p.threadId), eq(slotHolds.start, p.start), eq(slotHolds.status, "held")));
  let holdId = mine?.id;
  if (!holdId) {
    try {
      const [r] = await db().insert(slotHolds).values({ threadId: p.threadId, applicationId: p.appId, start: p.start, end, status: "booked", expiresAt: end, calendarEventIds: {} }).returning();
      holdId = r.id;
    } catch {
      return { ok: false as const, reason: "slot was just taken" };
    }
  }
  if (mine) {
    // delete my HOLD events on this slot before creating the real one
    const cals = calendarsFor(true);
    for (const [who, ev] of Object.entries(mine.calendarEventIds as Record<string, string>)) await calendar().deleteEvent(cals[who] ?? kushalCalendarId(), ev).catch(() => {});
    await db().update(slotHolds).set({ status: "booked", calendarEventIds: {} }).where(eq(slotHolds.id, mine.id));
  }
  const attendees = [p.founderEmail, ...p.partnerEmails];
  const ev = await calendar().createEvent({
    calendarId: kushalCalendarId(),
    summary: `All In Capital x ${p.company}: intro call`,
    description: `30-minute intro call.${p.isDeeptech ? " Aditya joins (deeptech)." : ""} Booked by the screening desk scheduling agent.`,
    start: p.start,
    end,
    attendees,
    withMeet: true,
  });
  // for deeptech, Aditya's calendar gets the invite as an attendee; if his calendar is a separate demo calendar, block it too
  const a = adityaCalendarId();
  if (p.isDeeptech && a && !attendees.includes(a)) {
    await calendar().createEvent({ calendarId: a, summary: `All In Capital x ${p.company}: intro call (Aditya)`, start: p.start, end, description: ev.meetLink ? `Meet: ${ev.meetLink}` : undefined }).catch(() => {});
  }
  await db().update(slotHolds).set({ calendarEventIds: { kushal: ev.eventId } }).where(eq(slotHolds.id, holdId!));
  await releaseThreadHolds(p.threadId, holdId);
  const [m] = await db()
    .insert(meetings)
    .values({ applicationId: p.appId, threadId: p.threadId, start: p.start, end, calendarEventId: ev.eventId, meetLink: ev.meetLink ?? null, attendees, isMock: calendar().mode === "mock" })
    .returning();
  await audit("agent", "meeting:booked", { start: p.start.toISOString(), meet: ev.meetLink, attendees }, p.appId);
  return { ok: true as const, meeting: m, label: formatIst(p.start) };
}

/** Count of slots that are booked twice (eval: must be 0). */
export async function doubleBookings() {
  const rows = await db().select().from(slotHolds).where(or(eq(slotHolds.status, "booked")));
  const seen = new Map<number, number>();
  for (const r of rows) seen.set(r.start.getTime(), (seen.get(r.start.getTime()) ?? 0) + 1);
  return [...seen.values()].filter((n) => n > 1).length;
}
