import { describe, expect, it } from "vitest";
import type { ExtractionT } from "@/lib/extract";
import { businessTypes, checkMissingNumbers, checkPortfolio, checkSector, checkSourceAndRouting, checkStageCheque, conceptsOf, runRules } from "@/lib/rules";
import { classifyFile, pairUploads } from "@/lib/intake";

const cfg = { preseed_raise_ok_inr_cr: 8.5, preseed_raise_stretch_inr_cr: 20, stage_ok: ["pre-seed", "seed"], stage_mismatch: ["series a", "series b"] };
const S = { file: "form" as const, page: 1 };
const D = { file: "deck" as const, page: 3 };
const f = <T>(value: T | null) => ({ value, source: value == null ? null : S });

/** Synthetic extraction builder: generic fictional companies, not the case applicants. */
function x(over: Partial<ExtractionT> = {}): ExtractionT {
  return {
    company: f("Acme"), legal_name: f(null), website: f(null), city: f("Pune"), incorporation_date: f(null),
    one_liner: f("Widgets for shops"), founders: [], equity_split: f(null), team_composition: f(null), outsourced_or_contract_staff: f(null),
    sector_selected: f("Consumer tech"), stage_selected: f("Pre-seed"), raise_inr_cr: { value: 3, source: D }, valuation_inr_cr: f(15), valuation_type: f(null),
    traction_metrics: [{ metric: "users", value: "100", period: null, source: D }], unit_economics: [], repeat_retention: f(null),
    credit_or_regulatory: [], competition_claims: [], use_of_funds: f(null),
    application_source: { kind: "cold", from_whom: null, source: S }, existing_investors: f(null), milestones_promised: [], form_deck_conflicts: [],
    likely_sector: { normalised: "consumer_tech", business_model: "consumer_app", mislabel: false, reason: "" },
    is_deeptech: false, founder_email: null,
    ...over,
  };
}

describe("stage and cheque", () => {
  it("passes a normal pre-seed raise", () => expect(checkStageCheque(x(), cfg)).toEqual([]));
  it("flags Series A label and large raise", () => {
    const fl = checkStageCheque(x({ stage_selected: f("Series A"), raise_inr_cr: f(30) }), cfg);
    expect(fl.map((q) => q.severity)).toEqual(["high", "high"]);
  });
  it("flags a stretch raise as medium", () => expect(checkStageCheque(x({ raise_inr_cr: f(12) }), cfg)[0].severity).toBe("medium"));
  it("flags a missing raise (missing numbers drag, never skipped)", () => expect(checkStageCheque(x({ raise_inr_cr: f(null) }), cfg)[0].details).toMatchObject({ missing: "raise" }));
});

describe("sector", () => {
  it("flags outside written thesis and mislabel", () => {
    const fl = checkSector(x({ likely_sector: { normalised: "saas", business_model: "saas", mislabel: true, reason: "B2B tool" } }));
    expect(fl.map((q) => q.code).sort()).toEqual(["outside_thesis", "sector_mislabel"]);
  });
  it("flags crypto as high", () => {
    const fl = checkSector(x({ likely_sector: { normalised: "fintech", business_model: "crypto", mislabel: false, reason: "" } }));
    expect(fl[0]).toMatchObject({ code: "outside_thesis", severity: "high" });
  });
  it("does not flag an in-thesis fintech", () => expect(checkSector(x({ likely_sector: { normalised: "fintech", business_model: "payments", mislabel: false, reason: "" } }))).toEqual([]));
});

describe("missing numbers by business type", () => {
  it("consumer brand without repeat data", () => {
    const fl = checkMissingNumbers(x({ likely_sector: { normalised: "consumer_brand", business_model: "consumer_brand", mislabel: false, reason: "" } }));
    expect(fl.map((q) => q.details?.missing)).toContain("Repeat rate / cohorts");
  });
  it("consumer brand with repeat data is fine on repeat", () => {
    const fl = checkMissingNumbers(x({ likely_sector: { normalised: "consumer_brand", business_model: "consumer_brand", mislabel: false, reason: "" }, repeat_retention: f("38% of buyers reorder within 90 days; gross margin 62%") }));
    expect(fl.map((q) => q.details?.missing)).not.toContain("Repeat rate / cohorts");
    expect(fl.map((q) => q.details?.missing)).not.toContain("Gross / contribution margin");
  });
  it("lending detected from text; missing defaults and risk holder", () => {
    const e = x({ credit_or_regulatory: [{ item: "NBFC", detail: "Loans via NBFC partner", source: S }] });
    expect(businessTypes(e)).toContain("lending");
    const miss = checkMissingNumbers(e).map((q) => q.details?.missing);
    expect(miss).toContain("Default / repayment data");
    expect(miss).toContain("Who holds the credit risk");
  });
  it("lending with first-loss and defaults reported", () => {
    const e = x({ credit_or_regulatory: [{ item: "NBFC", detail: "Loans via NBFC partner; we take first-loss; defaults 1.2%", source: S }] });
    expect(checkMissingNumbers(e)).toEqual([]);
  });
  it("saas needs MRR and churn", () => {
    const miss = checkMissingNumbers(x({ likely_sector: { normalised: "saas", business_model: "saas", mislabel: false, reason: "" } })).map((q) => q.details?.missing);
    expect(miss).toEqual(expect.arrayContaining(["MRR / ARR", "Churn / retention"]));
  });
  it("deeptech needs customer and regulatory path", () => {
    const miss = checkMissingNumbers(x({ is_deeptech: true, traction_metrics: [{ metric: "prototype", value: "v2", period: null, source: S }] })).map((q) => q.details?.missing);
    expect(miss).toEqual(expect.arrayContaining(["Paying customer / pilot", "Regulatory path"]));
  });
  it("no traction at all", () => expect(checkMissingNumbers(x({ traction_metrics: [] })).map((q) => q.details?.missing)).toContain("Traction metrics"));
});

describe("source and routing", () => {
  it("warm intro and deeptech routing", () => {
    const fl = checkSourceAndRouting(x({ is_deeptech: true, application_source: { kind: "warm_intro", from_whom: "a portfolio founder", source: S } }));
    expect(fl.map((q) => q.code)).toEqual(["source", "deeptech_routing"]);
    expect(fl[0].reason).toContain("Warm intro");
  });
});

describe("portfolio conflict", () => {
  const port = [
    { name: "NoteCo", one_liner: "AI meeting recorder that writes call summaries", site_categories: "SAAS", sector: "saas_b2b" },
    { name: "ShineSilver", one_liner: "Silver jewellery brand", site_categories: null, sector: "consumer_brand" },
    { name: "CategoryOnly", one_liner: null, site_categories: "SAAS", sector: "saas_b2b" },
  ];
  it("concept clusters match different wording", () => expect([...conceptsOf("transcribes sales calls into CRM notes")]).toContain("meeting_intelligence"));
  it("flags overlap even when the application never names the company", () => {
    const fl = checkPortfolio(x({ one_liner: f("Call transcription and CRM updates for field sales teams") }), port);
    expect(fl[0]).toMatchObject({ code: "portfolio_conflict", severity: "high" });
    expect(fl[0].details?.portfolio).toBe("NoteCo");
  });
  it("uses embedding similarity when keywords miss", () => {
    const fl = checkPortfolio(x({ one_liner: f("Something unusual") }), port, { CategoryOnly: 0.9 });
    expect(fl.some((q) => q.details?.portfolio === "CategoryOnly")).toBe(true);
  });
  it("reports clean result against KNOWN portfolio only", () => {
    const fl = checkPortfolio(x({ one_liner: f("Tractor rental for orchards") }), port, {}, "List is partial.");
    expect(fl[0]).toMatchObject({ severity: "info" });
    expect(fl[0].reason).toContain("KNOWN portfolio");
  });
});

describe("runRules integration", () => {
  it("returns flags with severity and plain-English reason", () => {
    const fl = runRules(x({ form_deck_conflicts: [{ field: "users", form_says: "120", deck_says: "90", severity: "medium" }] }), { cfg, companies: [] });
    expect(fl.every((q) => q.reason.length > 10 && q.severity)).toBe(true);
    expect(fl.map((q) => q.code)).toContain("form_deck_conflict");
  });
});

describe("intake pairing", () => {
  it("classifies names", () => {
    expect(classifyFile("Acme_Form Response.pdf")).toEqual({ company: "Acme", kind: "form" });
    expect(classifyFile("Application_03_Acme_Deck.pdf")).toEqual({ company: "Acme", kind: "deck" });
  });
  it("pairs case-insensitively", () => {
    const p = pairUploads([{ name: "acme_deck.pdf" }, { name: "Acme_Form.pdf" }, { name: "Other_Deck.pdf" }]);
    expect(p).toHaveLength(2);
    expect(p.find((g) => g.company.toLowerCase() === "acme")).toMatchObject({ form: { name: "Acme_Form.pdf" }, deck: { name: "acme_deck.pdf" } });
  });
});

describe("thin deck", () => {
  it("flags traction and raise that appear only in the form", () => {
    const e = x({ traction_metrics: [{ metric: "users", value: "100", period: null, source: S }], raise_inr_cr: { value: 1, source: S } });
    const miss = checkMissingNumbers(e).map((q) => q.details?.missing);
    expect(miss).toEqual(expect.arrayContaining(["Traction numbers in the deck", "Raise and milestones in the deck"]));
  });
});
