/**
 * Phase 3: deterministic rule checker. Pure functions (unit-tested). No LLM calls here:
 * embedding similarities for the portfolio check are computed by the caller and passed in.
 * Rules are generic (by business type / thesis config), never per-applicant.
 */
import type { ExtractionT } from "./extract";

export type Severity = "info" | "low" | "medium" | "high" | "critical";
export type Flag = { code: string; severity: Severity; reason: string; details?: Record<string, unknown> };

export type RulesConfig = {
  preseed_raise_ok_inr_cr: number;
  preseed_raise_stretch_inr_cr: number;
  stage_ok: string[];
  stage_mismatch: string[];
};
export type PortfolioEntry = { name: string; one_liner: string | null; site_categories: string | null; sector: string };

const v = <T>(f: { value: T | null } | undefined | null) => (f ? f.value : null);
const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();

/** All free text in an extraction, for keyword presence checks. */
export function corpus(x: ExtractionT): string {
  return lc(
    [
      v(x.one_liner),
      v(x.repeat_retention),
      ...x.traction_metrics.map((t) => `${t.metric} ${t.value}`),
      ...x.unit_economics.map((u) => `${u.metric} ${u.value}`),
      ...x.credit_or_regulatory.map((c) => `${c.item} ${c.detail}`),
      ...x.milestones_promised.map((m) => m.milestone),
      ...x.competition_claims.map((c) => c.claim),
    ].join(" \n "),
  );
}

// ---------- stage & cheque ----------
export function checkStageCheque(x: ExtractionT, cfg: RulesConfig): Flag[] {
  const out: Flag[] = [];
  const stage = lc(v(x.stage_selected));
  const raise = v(x.raise_inr_cr);
  if (stage && cfg.stage_mismatch.some((s) => stage.includes(s)))
    out.push({ code: "stage_cheque", severity: "high", reason: `Stage selected is "${v(x.stage_selected)}". The fund invests at pre-seed and seed.`, details: { stage, raise } });
  if (raise == null) out.push({ code: "stage_cheque", severity: "medium", reason: "Raise amount not stated, so cheque fit cannot be checked. A missing number counts against the application.", details: { missing: "raise" } });
  else if (raise > cfg.preseed_raise_stretch_inr_cr)
    out.push({ code: "stage_cheque", severity: "high", reason: `Raising INR ${raise} Cr, far above a pre-seed round (the fund leads under ~INR ${cfg.preseed_raise_ok_inr_cr} Cr). The fund would be a small cheque in a larger round.`, details: { raise } });
  else if (raise > cfg.preseed_raise_ok_inr_cr)
    out.push({ code: "stage_cheque", severity: "medium", reason: `Raising INR ${raise} Cr, above the ~INR ${cfg.preseed_raise_ok_inr_cr} Cr (USD 1M) the fund can lead. Stretch for pre-seed.`, details: { raise } });
  return out;
}

// ---------- thesis sector ----------
const WRITTEN = new Set(["fintech", "deeptech", "consumer_tech", "consumer_brand"]);
export function checkSector(x: ExtractionT): Flag[] {
  const out: Flag[] = [];
  const s = x.likely_sector;
  if (s.business_model === "crypto")
    out.push({ code: "outside_thesis", severity: "high", reason: "Crypto/Web3 trading business. The memos show the fund declining crypto quickly as outside its areas (revealed thesis; no public exclusion list).", details: { business_model: s.business_model } });
  if (!WRITTEN.has(s.normalised))
    out.push({ code: "outside_thesis", severity: "medium", reason: `Business reads as "${s.normalised}" (${s.business_model}), outside the four written focus sectors (fintech, deeptech, consumer tech, consumer brands). Fund II calls itself sector-agnostic, so this is a flag for Kushal, not a decline.`, details: { normalised: s.normalised, business_model: s.business_model } });
  if (s.mislabel)
    out.push({ code: "sector_mislabel", severity: "medium", reason: `Founder selected "${v(x.sector_selected) ?? "?"}" but the business looks like ${s.normalised} / ${s.business_model}: ${s.reason}`, details: { selected: v(x.sector_selected), likely: s.normalised } });
  return out;
}

// ---------- missing numbers by business type ----------
export type BizType = "consumer_brand" | "lending" | "saas" | "deeptech" | "other";
export function businessTypes(x: ExtractionT): BizType[] {
  const t = new Set<BizType>();
  const c = corpus(x);
  const bm = x.likely_sector.business_model;
  if (bm === "consumer_brand" || x.likely_sector.normalised === "consumer_brand") t.add("consumer_brand");
  const creditText = lc([v(x.one_liner), ...x.credit_or_regulatory.map((r) => `${r.item} ${r.detail}`)].join(" "));
  if (bm === "lending" || /\b(nbfc|lending|credit book|credit line|bnpl|pay later|disburs|lend to|we lend|working capital finance|invoice financ)/.test(creditText)) t.add("lending");
  if (bm === "saas" || x.likely_sector.normalised === "saas" || /\b(saas|subscription|mrr|arr)\b/.test(c)) t.add("saas");
  if (x.is_deeptech || bm === "deeptech_hardware") t.add("deeptech");
  if (!t.size) t.add("other");
  return [...t];
}

const has = (c: string, re: RegExp) => re.test(c);
export function checkMissingNumbers(x: ExtractionT): Flag[] {
  const out: Flag[] = [];
  const c = corpus(x);
  const types = businessTypes(x);
  const miss = (what: string, why: string, severity: Severity = "high") =>
    out.push({ code: "missing_numbers", severity, reason: `${what} not reported. ${why}`, details: { missing: what, types } });

  if (types.includes("consumer_brand")) {
    if (!v(x.repeat_retention) && !has(c, /\b(repeat|cohort|retention|reorder|returning)\b/)) miss("Repeat rate / cohorts", "For a consumer brand this is the core question; the fund treats a missing repeat number as a drag, not a skip.");
    if (!has(c, /\b(gross margin|contribution|cm1|cm2|margin)\b/)) miss("Gross / contribution margin", "Consumer-brand investing turns on margin fluency.", "medium");
  }
  if (types.includes("lending")) {
    if (!has(c, /\b(default|npa|delinquen|overdue|dpd|write[- ]?off|loss rate|repayment)/)) miss("Default / repayment data", "Lending files need loss data.");
    if (!has(c, /\b(first[- ]loss|we (hold|take|bear)|own (the )?risk|risk (sits|is held)|balance sheet|guarantee|fldg)/)) miss("Who holds the credit risk", "The fund backs lenders only when founders own the risk.");
  }
  if (types.includes("saas")) {
    if (!has(c, /\b(mrr|arr|recurring revenue|monthly revenue)\b/)) miss("MRR / ARR", "SaaS files need recurring revenue.");
    if (!has(c, /\b(churn|logo retention|net revenue retention|nrr|renewal)/)) miss("Churn / retention", "SaaS files need churn.");
  }
  if (types.includes("deeptech")) {
    if (!has(c, /\b(customer|pilot|loi|purchase order|po\b|contract|paying)/)) miss("Paying customer / pilot", "Deeptech passes failed on 'no customer'.");
    if (!has(c, /\b(dgca|regulat|certif|approval|licen[cs]e|permission|clearance|type certificate|bvlos|cdsco|bis)\b/)) miss("Regulatory path", "Deeptech with a regulator in the way needs a milestone sequence.");
  }
  if (!x.traction_metrics.length) miss("Traction metrics", "No traction numbers in form or deck.", "high");
  // Thin deck: key numbers only in the form (founders chose not to put them in front of investors)
  const inDeck = (s: { file: string } | null | undefined) => s?.file === "deck";
  if (x.traction_metrics.length && !x.traction_metrics.some((t) => inDeck(t.source) && /\d/.test(t.value)))
    miss("Traction numbers in the deck", "The deck shows no numeric traction figures (only words like 'thousands'); the numbers appear only in the form.", "medium");
  if (x.raise_inr_cr.value != null && !inDeck(x.raise_inr_cr.source) && !x.milestones_promised.some((m) => inDeck(m.source)))
    miss("Raise and milestones in the deck", "The deck states neither the raise nor what it buys; the raise appears only in the form.", "medium");
  return out;
}

// ---------- source & routing ----------
export function checkSourceAndRouting(x: ExtractionT): Flag[] {
  const out: Flag[] = [];
  const s = x.application_source;
  out.push({
    code: "source",
    severity: "info",
    reason: s.kind === "warm_intro" ? `Warm intro${s.from_whom ? `: ${s.from_whom}` : ""}.` : s.kind === "cold" ? "Cold application (public form / no intro)." : "Application source not stated.",
    details: { kind: s.kind, from: s.from_whom },
  });
  if (x.is_deeptech)
    out.push({ code: "deeptech_routing", severity: "info", reason: "Deeptech: route to Aditya. He joins the first call, and the partners take the second call themselves.", details: {} });
  return out;
}

// ---------- form vs deck ----------
export function checkConflicts(conflicts: ExtractionT["form_deck_conflicts"]): Flag[] {
  return conflicts.map((c) => ({
    code: "form_deck_conflict",
    severity: (c.severity === "high" ? "high" : c.severity === "medium" ? "medium" : "low") as Severity,
    reason: `${c.field}: form says "${c.form_says}", deck says "${c.deck_says}".`,
    details: c,
  }));
}

// ---------- portfolio conflict ----------
const STOP = new Set("a an and the of for to in on with by from at as is are our we your you their it its that this into via app platform startup company india indian tech technology based small large b2b b2c d2c online digital ai-powered ai using".split(" "));
export function tokens(s: string): Set<string> {
  return new Set(
    lc(s)
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .map((w) => w.replace(/(ies)$/, "y").replace(/(s)$/, ""))
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}
/** Generic concept clusters so different words for the same product space match (not tied to any applicant). */
export const CONCEPTS: Record<string, string[]> = {
  meeting_intelligence: ["meeting", "call", "transcript", "transcription", "recording", "summary", "summarise", "summarize", "note", "notetaker", "conversation"],
  sales_tools: ["sale", "crm", "pipeline", "lead", "prospect", "revenue"],
  lending: ["loan", "lending", "credit", "nbfc", "bnpl", "emi", "borrow"],
  payments: ["payment", "invoice", "receivable", "payable", "upi", "settlement", "collection"],
  wealth: ["bond", "wealth", "mutual"],
  grocery_retail: ["kirana", "grocery", "supermarket", "restock", "fmcg"],
  jewellery: ["jewellery", "jewelry", "silver", "gold", "diamond"],
  beauty_personal: ["skincare", "beauty", "haircare", "cosmetic", "shapewear"],
  food_brand: ["food", "snack", "sauce", "beverage", "millet", "grain", "flour"],
  travel: ["travel", "trip", "hotel", "itinerary", "tour"],
  health: ["health", "clinic", "fertility", "mental", "caregiver", "eldercare", "elder", "patient", "doctor", "nursing"],
  logistics: ["logistic", "warehouse", "fleet", "sorting", "freight", "shipment"],
  aerial: ["drone", "evtol", "aircraft", "uav", "aerial"],
  energy_water: ["pump", "solar", "irrigation", "water", "energy", "motor"],
  agri: ["farmer", "farm", "agri", "tractor", "crop", "rural"],
  accounting_compliance: ["accounting", "tax", "gst", "compliance", "audit", "bookkeeping", "chartered"],
  property: ["rent", "rental", "tenant", "landlord", "property", "housing"],
  education: ["exam", "test", "learning", "course", "tutor", "student", "edtech"],
  hr_recruiting: ["referral", "recruit", "hiring", "employee"],
  email_marketing: ["email", "marketing", "campaign"],
};
export function conceptsOf(s: string): Set<string> {
  const t = tokens(s);
  const out = new Set<string>();
  for (const [c, words] of Object.entries(CONCEPTS)) if (words.some((w) => [...t].some((x) => x.startsWith(w)))) out.add(c);
  return out;
}

export function checkPortfolio(
  x: ExtractionT,
  companies: PortfolioEntry[],
  similarity: Record<string, number> = {},
  completenessNote = "",
): Flag[] {
  const out: Flag[] = [];
  const appText = [v(x.one_liner), x.likely_sector.business_model, ...x.competition_claims.map((c) => c.claim)].join(" ");
  const appConcepts = conceptsOf(appText);
  const appName = lc(v(x.company));
  for (const p of companies) {
    const pText = [p.one_liner, p.site_categories].filter(Boolean).join(" ");
    const shared = [...conceptsOf(pText)].filter((c) => appConcepts.has(c) && c !== "sales_tools");
    const sim = similarity[p.name] ?? 0;
    const nameHit = appName && (lc(appText).includes(lc(p.name)) || lc(p.name) === appName);
    const reasons: string[] = [];
    // A single shared broad concept is only a flag when the descriptions are also semantically close (or
    // embeddings are unavailable); a niche concept like meeting intelligence counts on its own.
    const NICHE = new Set(["meeting_intelligence", "jewellery", "aerial", "accounting_compliance", "property", "energy_water", "email_marketing", "hr_recruiting"]);
    const embeddingsAvailable = Object.keys(similarity).length > 0;
    const conceptHit = p.one_liner && shared.length > 0 && (shared.length >= 2 || shared.some((c) => NICHE.has(c)) || !embeddingsAvailable || sim >= 0.6);
    if (nameHit) reasons.push(`application mentions ${p.name}`);
    if (conceptHit) reasons.push(`shared product space: ${shared.join(", ")}`);
    if (sim >= 0.78) reasons.push(`one-liner similarity ${sim.toFixed(2)}`);
    if (!reasons.length) continue;
    const strong = nameHit || sim >= 0.85 || (conceptHit && sim >= 0.7) || shared.some((c) => NICHE.has(c));
    out.push({
      code: "portfolio_conflict",
      severity: strong ? "high" : "medium",
      reason: `Possible overlap with portfolio company ${p.name}${p.one_liner ? ` (${p.one_liner})` : ""}: ${reasons.join("; ")}. Default is no: hold until the portfolio founder is told (Partner Meeting 4).`,
      details: { portfolio: p.name, shared, similarity: sim },
    });
  }
  if (!out.length)
    out.push({ code: "portfolio_conflict", severity: "info", reason: `No conflict with the KNOWN portfolio. ${completenessNote}`.trim(), details: { checked: companies.length } });
  return out;
}

export function runRules(
  x: ExtractionT,
  ctx: { cfg: RulesConfig; companies: PortfolioEntry[]; similarity?: Record<string, number>; completenessNote?: string; conflicts?: ExtractionT["form_deck_conflicts"] },
): Flag[] {
  return [
    ...checkStageCheque(x, ctx.cfg),
    ...checkPortfolio(x, ctx.companies, ctx.similarity, ctx.completenessNote),
    ...checkSector(x),
    ...checkMissingNumbers(x),
    ...checkSourceAndRouting(x),
    ...checkConflicts(ctx.conflicts ?? x.form_deck_conflicts),
  ];
}

export const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
