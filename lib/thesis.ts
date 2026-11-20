import thesisJson from "@/data/thesis/thesis.json";
import portfolioJson from "@/data/thesis/portfolio.json";

export type Criterion = { key: string; name: string; definition: string; anchors: Record<string, string> };
export type RevealedPattern = { id: string; pattern: string; evidence: Array<{ memo: string; note: string }> };
export type PortfolioCo = {
  name: string;
  fund: string;
  site_categories: string | null;
  one_liner: string | null;
  sector: string;
  source_url: string;
  source_date: string;
  verified: string;
};

export const thesis = thesisJson as unknown as {
  written_thesis: { summary: string; sectors: { value: string[] }; [k: string]: unknown };
  anti_thesis: { value: string; what_absence_costs: string; revealed_exclusions: Array<{ pattern: string; memo: string }> };
  revealed_thesis: RevealedPattern[];
  drift_note: string;
  criteria: Criterion[];
  rules_config: {
    preseed_raise_ok_inr_cr: number;
    preseed_raise_stretch_inr_cr: number;
    fund_cheque_inr_cr: [number, number];
    stage_ok: string[];
    stage_mismatch: string[];
  };
};

export const portfolio = portfolioJson as unknown as {
  completeness: { estimate: string; detail: string };
  companies: PortfolioCo[];
  partner_notes: Array<{ name: string; note: string; source_url: string }>;
};

export const CRITERIA_KEYS = thesis.criteria.map((c) => c.key);

/**
 * Leave-one-out view of the revealed thesis: drop every piece of evidence that cites the held-out company,
 * and drop patterns left with no evidence, so a memo never "sees" its own decision during the backtest.
 */
export function revealedFor(holdOut?: string): RevealedPattern[] {
  if (!holdOut) return thesis.revealed_thesis;
  const key = holdOut.toLowerCase().replace(/^the\s+/, "").split(/\s+/)[0];
  const cites = (s: string) => s.toLowerCase().includes(key);
  return thesis.revealed_thesis
    .map((p) => ({ ...p, evidence: p.evidence.filter((e) => !cites(e.memo) && !cites(e.note)) }))
    .filter((p) => p.evidence.length > 0 && !cites(p.pattern));
}

export function driftNoteFor(holdOut?: string) {
  if (!holdOut) return thesis.drift_note;
  const key = holdOut.toLowerCase().replace(/^the\s+/, "").split(/\s+/)[0];
  return thesis.drift_note.replace(new RegExp(`[^.]*${key}[^.]*\\.`, "gi"), "").trim();
}

export function portfolioFor(holdOut?: string) {
  if (!holdOut) return portfolio.companies;
  const key = holdOut.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]/g, "").slice(0, 6);
  return portfolio.companies.filter((c) => !c.name.toLowerCase().replace(/[^a-z0-9]/g, "").startsWith(key));
}
