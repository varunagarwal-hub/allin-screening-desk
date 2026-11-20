import { describe, expect, it } from "vitest";
import { z } from "zod";
import { hashInput, stableStringify } from "@/lib/cache";
import { parseLooseJson } from "@/lib/llm";
import { robotsAllows, parseRss, sourceTier } from "@/lib/research";
import { buildRaw, founderRecipient, stripQuoted } from "@/lib/gmail";
import { candidateSlots, freeSlots, isWithinRules, istParts, istToUtc, pickSpread } from "@/lib/calendar";

describe("cache hashing", () => {
  it("is key-order independent", () => {
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(stableStringify({ a: [2, { c: 2, d: 1 }], b: 1 }));
    expect(hashInput("x", { a: 1, b: 2 })).toBe(hashInput("x", { b: 2, a: 1 }));
    expect(hashInput("x", { a: 1 })).not.toBe(hashInput("y", { a: 1 }));
  });
});

describe("llm JSON parsing", () => {
  it("handles fences and prose", () => {
    expect(parseLooseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseLooseJson('Sure! {"a":[1,2]} done')).toEqual({ a: [1, 2] });
    expect(() => parseLooseJson("nothing here")).toThrow();
  });
  it("zod rejects wrong shapes", () => {
    expect(z.object({ a: z.number() }).safeParse(parseLooseJson('{"a":"x"}')).success).toBe(false);
  });
});

describe("research helpers", () => {
  it("robots.txt longest-match", () => {
    const r = "User-agent: *\nDisallow: /private\nAllow: /private/ok\n\nUser-agent: other\nDisallow: /";
    expect(robotsAllows(r, "/")).toBe(true);
    expect(robotsAllows(r, "/private/x")).toBe(false);
    expect(robotsAllows(r, "/private/ok/1")).toBe(true);
    expect(robotsAllows("", "/anything")).toBe(true);
  });
  it("parses Google News RSS", () => {
    const xml = `<?xml version="1.0"?><rss><channel><item><title>T1</title><link>https://n.example/1</link><pubDate>Mon, 01 Jan 2026</pubDate><source url="https://x">Mint</source></item></channel></rss>`;
    const hits = parseRss(xml);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ title: "T1", url: "https://n.example/1", snippet: "Mint", via: "rss" });
  });
  it("tiers sources", () => {
    expect(sourceTier("https://www.rbi.org.in/x")).toBe(1);
    expect(sourceTier("https://acme.in/about", "acme.in")).toBe(1);
    expect(sourceTier("https://inc42.com/a")).toBe(2);
    expect(sourceTier("https://someblog.substack.com/a")).toBe(3);
    expect(sourceTier("https://www.reddit.com/r/x")).toBe(4);
  });
});

describe("gmail helpers", () => {
  it("DEMO_MODE redirects founder email", () => {
    process.env.DEMO_MODE = "true";
    process.env.DEMO_FOUNDER_EMAIL = "demo@test.local";
    expect(founderRecipient("founder@startup.example")).toBe("demo@test.local");
    process.env.DEMO_MODE = "false";
    expect(founderRecipient("founder@startup.example")).toBe("founder@startup.example");
  });
  it("builds a raw message with reply headers", () => {
    const raw = Buffer.from(buildRaw("a@x", { to: "b@y", subject: "Hi ₹", body: "hello", inReplyTo: "<m1@x>" }), "base64url").toString();
    expect(raw).toContain("In-Reply-To: <m1@x>");
    expect(raw).toContain("=?UTF-8?B?");
    expect(raw.endsWith("hello")).toBe(true);
  });
  it("strips quoted history", () => {
    expect(stripQuoted("Thursday works.\n\nOn Tue, 1 Dec 2026, Riya wrote:\n> slots")).toBe("Thursday works.");
  });
});

describe("calendar slot rules", () => {
  // Wed 18 Nov 2026, 10:00 IST
  const now = istToUtc(2026, 10, 18, 10, 0);
  it("only Tue/Thu 14:00–17:30 IST, 30 min, within 14 days", () => {
    const slots = candidateSlots(now);
    expect(slots.length).toBe(4 * 8); // Thu 19, Tue 24, Thu 26, Tue 1 Dec
    for (const s of slots) {
      const p = istParts(s.start);
      expect([2, 4]).toContain(p.dow);
      expect(p.hh).toBeGreaterThanOrEqual(14);
      expect(p.hh * 60 + p.mm).toBeLessThanOrEqual(17 * 60 + 30);
      expect(s.end.getTime() - s.start.getTime()).toBe(30 * 60_000);
    }
  });
  it("validates proposed times", () => {
    expect(isWithinRules(istToUtc(2026, 10, 19, 15, 0), now)).toBe(true);
    expect(isWithinRules(istToUtc(2026, 10, 19, 18, 0), now)).toBe(false); // ends after 18:00
    expect(isWithinRules(istToUtc(2026, 10, 20, 15, 0), now)).toBe(false); // Friday
  });
  it("removes busy slots and picks 3 spread-out ones", () => {
    const busy = [{ start: istToUtc(2026, 10, 19, 14, 0), end: istToUtc(2026, 10, 19, 18, 0) }];
    const free = freeSlots(candidateSlots(now), busy);
    expect(free.every((s) => istParts(s.start).d !== 19)).toBe(true);
    const picked = pickSpread(free, 3);
    expect(picked).toHaveLength(3);
    expect(new Set(picked.map((s) => istParts(s.start).d)).size).toBe(3);
  });
});
