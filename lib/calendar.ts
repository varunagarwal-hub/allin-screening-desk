/**
 * Calendar interface with Google + mock implementations (mock = `mock_calendar_events` table).
 * Also holds the pure slot rules: Tue/Thu, 14:00–18:00 IST, 30-minute slots, next 2 weeks.
 */
import { google } from "googleapis";
import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, lt, ne } from "drizzle-orm";
import { googleAuth, hasGoogleCreds } from "./google";
import { db } from "./db";
import { mockCalendarEvents } from "./schema";

export type Interval = { start: Date; end: Date };
export type NewEvent = {
  calendarId: string;
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  attendees?: string[];
  withMeet?: boolean;
  tentative?: boolean; // HOLD events
};

export interface Calendar {
  readonly mode: "google" | "mock";
  freeBusy(calendarIds: string[], timeMin: Date, timeMax: Date): Promise<Record<string, Interval[]>>;
  createEvent(e: NewEvent): Promise<{ eventId: string; meetLink?: string }>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
}

export const kushalCalendarId = () => process.env.KUSHAL_CALENDAR_ID || "primary";
/** Aditya's calendar. In mock mode defaults to a placeholder; with real Google it must be set (null = not configured). */
export const adityaCalendarId = (): string | null => process.env.ADITYA_CALENDAR_ID || (hasGoogleCreds() ? null : "aditya@mock");

// ---------------- slot rules (pure, unit-testable) ----------------
export const IST_OFFSET_MIN = 330; // IST has no DST
export const SLOT_RULES = { days: [2, 4], startHour: 14, endHour: 18, slotMin: 30, horizonDays: 14 } as const;

/** Wall-clock IST → UTC Date. */
export function istToUtc(y: number, m: number, d: number, hh: number, mm: number): Date {
  return new Date(Date.UTC(y, m, d, hh, mm) - IST_OFFSET_MIN * 60_000);
}

/** IST calendar fields for a Date. */
export function istParts(dt: Date) {
  const s = new Date(dt.getTime() + IST_OFFSET_MIN * 60_000);
  return { y: s.getUTCFullYear(), m: s.getUTCMonth(), d: s.getUTCDate(), dow: s.getUTCDay(), hh: s.getUTCHours(), mm: s.getUTCMinutes() };
}

/** All rule-compliant candidate slots starting after `now` within the horizon. */
export function candidateSlots(now: Date, rules = SLOT_RULES): Interval[] {
  const out: Interval[] = [];
  const p = istParts(now);
  for (let i = 0; i <= rules.horizonDays; i++) {
    const day = istToUtc(p.y, p.m, p.d + i, 0, 0);
    const dp = istParts(day);
    if (!(rules.days as readonly number[]).includes(dp.dow)) continue;
    for (let mins = rules.startHour * 60; mins + rules.slotMin <= rules.endHour * 60; mins += rules.slotMin) {
      const start = istToUtc(dp.y, dp.m, dp.d, Math.floor(mins / 60), mins % 60);
      if (start <= now) continue;
      out.push({ start, end: new Date(start.getTime() + rules.slotMin * 60_000) });
    }
  }
  return out;
}

/** True if a proposed start is a rule-compliant slot (Tue/Thu, 14:00–17:30 IST start, on the half hour). */
export function isWithinRules(start: Date, now: Date, rules = SLOT_RULES): boolean {
  return candidateSlots(now, rules).some((s) => s.start.getTime() === start.getTime());
}

export const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

export function freeSlots(candidates: Interval[], busy: Interval[]): Interval[] {
  return candidates.filter((c) => !busy.some((b) => overlaps(c, b)));
}

/** Pick n slots spread out across the available set (different days first, then spaced times). */
export function pickSpread(slots: Interval[], n = 3): Interval[] {
  if (slots.length <= n) return slots;
  const byDay = new Map<string, Interval[]>();
  for (const s of slots) {
    const p = istParts(s.start);
    const k = `${p.y}-${p.m}-${p.d}`;
    byDay.set(k, [...(byDay.get(k) ?? []), s]);
  }
  const days = [...byDay.values()];
  const picked: Interval[] = [];
  // evenly spaced days
  const dayIdx = Array.from({ length: Math.min(n, days.length) }, (_, i) => Math.round((i * (days.length - 1)) / Math.max(1, Math.min(n, days.length) - 1)));
  const timePref = [0.15, 0.85, 0.5]; // early, late, middle of afternoon
  dayIdx.forEach((di, i) => {
    const d = days[di];
    picked.push(d[Math.min(d.length - 1, Math.floor(timePref[i % 3] * d.length))]);
  });
  // fill if fewer days than n
  for (const s of slots) {
    if (picked.length >= n) break;
    if (!picked.includes(s) && picked.every((p) => Math.abs(p.start.getTime() - s.start.getTime()) >= 90 * 60_000)) picked.push(s);
  }
  return picked.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function formatIst(d: Date) {
  return d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) + " IST";
}

// ---------------- Google ----------------
class GoogleCalendar implements Calendar {
  readonly mode = "google" as const;
  private api = google.calendar({ version: "v3", auth: googleAuth() });

  async freeBusy(calendarIds: string[], timeMin: Date, timeMax: Date) {
    const r = await this.api.freebusy.query({
      requestBody: { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), timeZone: "Asia/Kolkata", items: calendarIds.map((id) => ({ id })) },
    });
    const out: Record<string, Interval[]> = {};
    for (const id of calendarIds) {
      const c = r.data.calendars?.[id];
      if (c?.errors?.length) throw new Error(`freeBusy ${id}: ${c.errors.map((e) => e.reason).join(",")}`);
      out[id] = (c?.busy ?? []).map((b) => ({ start: new Date(b.start!), end: new Date(b.end!) }));
    }
    return out;
  }
  async createEvent(e: NewEvent) {
    const r = await this.api.events.insert({
      calendarId: e.calendarId,
      conferenceDataVersion: e.withMeet ? 1 : 0,
      sendUpdates: e.attendees?.length ? "all" : "none",
      requestBody: {
        summary: e.summary,
        description: e.description,
        start: { dateTime: e.start.toISOString(), timeZone: "Asia/Kolkata" },
        end: { dateTime: e.end.toISOString(), timeZone: "Asia/Kolkata" },
        status: e.tentative ? "tentative" : "confirmed",
        transparency: "opaque",
        attendees: e.attendees?.map((email) => ({ email })),
        ...(e.withMeet ? { conferenceData: { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
      },
    });
    return { eventId: r.data.id!, meetLink: r.data.hangoutLink ?? undefined };
  }
  async deleteEvent(calendarId: string, eventId: string) {
    await this.api.events.delete({ calendarId, eventId, sendUpdates: "none" });
  }
}

// ---------------- Mock ----------------
class MockCalendar implements Calendar {
  readonly mode = "mock" as const;
  async freeBusy(calendarIds: string[], timeMin: Date, timeMax: Date) {
    const rows = calendarIds.length
      ? await db()
          .select()
          .from(mockCalendarEvents)
          .where(and(inArray(mockCalendarEvents.calendarId, calendarIds), lt(mockCalendarEvents.start, timeMax), gt(mockCalendarEvents.end, timeMin), ne(mockCalendarEvents.status, "cancelled")))
      : [];
    const out: Record<string, Interval[]> = Object.fromEntries(calendarIds.map((id) => [id, []]));
    for (const r of rows) out[r.calendarId].push({ start: r.start, end: r.end });
    return out;
  }
  async createEvent(e: NewEvent) {
    const eventId = `mockevt-${randomUUID()}`;
    const meetLink = e.withMeet ? `https://meet.google.com/mock-${eventId.slice(8, 11)}-${eventId.slice(12, 16)}` : undefined;
    await db().insert(mockCalendarEvents).values({
      eventId,
      calendarId: e.calendarId,
      summary: e.summary,
      start: e.start,
      end: e.end,
      attendees: e.attendees ?? [],
      meetLink,
      status: e.tentative ? "tentative" : "confirmed",
    });
    return { eventId, meetLink };
  }
  async deleteEvent(_calendarId: string, eventId: string) {
    await db().update(mockCalendarEvents).set({ status: "cancelled" }).where(eq(mockCalendarEvents.eventId, eventId));
  }
}

let _cal: Calendar | null = null;
let _forceMock = false;
/** Evals use the DB-backed mock calendar so they never touch real calendars. */
export function forceMockCalendar(on: boolean) {
  _forceMock = on;
  _cal = null;
}
export function calendar(): Calendar {
  return (_cal ??= hasGoogleCreds() && !_forceMock ? new GoogleCalendar() : new MockCalendar());
}
