import { describe, expect, it } from "vitest";
import { stripOutcome } from "@/lib/evals";
import { editDistance } from "@/lib/drafts";
import { excerptInText } from "@/lib/research-agent";
import { enforceTraceability, type ScoreOutT } from "@/lib/scorer";
import { memoryTagScore } from "@/lib/memory";
import { revealedFor, portfolioFor, CRITERIA_KEYS } from "@/lib/thesis";
import { completeSignals, type FounderFileT } from "@/lib/founder";

describe("backtest stripping", () => {
  it("removes decision and outcome sentences", () => {
    const t = "Smart and hungry. Iyer dismissed default questions. That answer decided it. We passed on the round.";
    const s = stripOutcome(t);
    expect(s).toContain("Smart and hungry.");
    expect(s).not.toMatch(/decided|passed/);
  });
  it("leave-one-out revealed thesis drops patterns citing the held-out memo", () => {
    const all = revealedFor();
    const held = revealedFor("Coinlane");
    expect(held.length).toBeLessThan(all.length);
    expect(JSON.stringify(held)).not.toMatch(/coinlane/i);
  });
  it("backtest portfolio excludes the company's own entry", () => {
    expect(portfolioFor("The ePlane Company").some((p) => /eplane/i.test(p.name))).toBe(false);
    expect(portfolioFor().some((p) => /eplane/i.test(p.name))).toBe(true);
  });
});

describe("loop 2 edit distance", () => {
  it("counts word edits", () => {
    expect(editDistance("a b c", "a b c")).toBe(0);
    expect(editDistance("a b c", "a x c")).toBe(1);
    expect(editDistance("a b c", "a b c d e")).toBe(2);
  });
});

describe("anti-fabrication", () => {
  it("accepts real excerpts and rejects invented ones", () => {
    const text = "RBI's digital lending guidelines require the regulated entity to bear credit risk, with first loss default guarantee capped at 5%.";
    expect(excerptInText("bear credit risk, with first loss default guarantee capped at 5%", text)).toBe(true);
    expect(excerptInText("the company raised $10M from Sequoia last year", text)).toBe(false);
  });
});

describe("scorer traceability", () => {
  const base = (key: string) => ({ key, score: 3, confidence: 0.5, thesis_basis: "both" as const, rationale: "r", evidence: [{ claim_id: 999, ref: "x", note: "n" }], missing: [], memory_influence: [{ ref: "M7", effect: "lowered" }] });
  const out: ScoreOutT = { criteria: CRITERIA_KEYS.map(base), recommendation: "hold", driven_by: "revealed", driven_by_why: "w", partner_summary: "a\nb", what_would_change: "c", structure_not_people: false, call_questions: ["q"] };
  it("strips unknown claim ids and memory refs not in context", () => {
    const r = enforceTraceability(out, new Set([1, 2]), new Set(["M3"]));
    expect(r.out.criteria.every((c) => c.evidence[0].claim_id === null)).toBe(true);
    expect(r.out.criteria.every((c) => c.memory_influence.length === 0)).toBe(true);
    expect(r.notes.length).toBeGreaterThan(0);
  });
  it("refuses output missing a criterion (no score without a named criterion)", () => {
    expect(() => enforceTraceability({ ...out, criteria: out.criteria.slice(1) }, new Set(), new Set())).toThrow(/omitted/);
  });
});

describe("memory retrieval tags", () => {
  it("weights business model above sector", () => {
    expect(memoryTagScore({ sector: "fintech", businessModel: "lending", stage: null }, { sector: "fintech", businessModel: "lending", stage: null })).toBe(3);
    expect(memoryTagScore({ sector: "fintech", businessModel: "wealth", stage: null }, { sector: "fintech", businessModel: "lending", stage: null })).toBe(1);
  });
});

describe("founder file completeness", () => {
  it("fills skipped signals as unknown and downgrades unsourced claims", () => {
    const ff = { signals: [{ signal: "owns_risk", state: "present", evidence: "says so", source: null, call_only: false }], founder_market_fit: "", team_facts: [], red_flags: [], confidence: 0.5, public_trace: "none", call_questions: ["a", "b", "c"], memos_used: [] } as unknown as FounderFileT;
    const c = completeSignals(ff);
    expect(c.signals).toHaveLength(10);
    expect(c.signals.find((s) => s.signal === "owns_risk")?.state).toBe("unknown");
  });
});

import { localToIso } from "@/lib/scheduler-agent";
describe("timezone conversion in code", () => {
  it("IST default and Pacific", () => {
    expect(localToIso("2026-11-24T16:30", "Asia/Kolkata")).toBe("2026-11-24T11:00:00.000Z");
    expect(localToIso("2026-11-24T10:30", "America/Los_Angeles")).toBe("2026-11-24T18:30:00.000Z"); // PST, UTC-8
    expect(localToIso("2026-07-14T10:30", "America/Los_Angeles")).toBe("2026-07-14T17:30:00.000Z"); // PDT, UTC-7
    expect(localToIso("garbage", "Asia/Kolkata")).toBeNull();
  });
});
