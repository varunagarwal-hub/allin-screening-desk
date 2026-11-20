/** Phase 2: structured extraction of one application (form + deck) with per-field sources. */
import { z } from "zod";
import { generateJson, type PdfInput } from "./llm";
import { loadPrompt } from "./prompts";

export const Source = z
  .object({ file: z.enum(["form", "deck", "memo"]), page: z.number().int().nullable() })
  .nullable();
export type SourceT = z.infer<typeof Source>;

/** A value plus where it came from. value null => not stated anywhere. */
const F = <T extends z.ZodType>(t: T) => z.object({ value: t.nullable(), source: Source });
const Str = F(z.string());
const Num = F(z.number());

export const Founder = z.object({
  name: z.string(),
  role: z.string().nullable(),
  background: z.string().nullable(),
  tenure_years: z.number().nullable(),
  time_commitment: z.string().nullable(),
  prior_startups: z.string().nullable(),
  departed: z.boolean().nullable(),
  departure_note: z.string().nullable(),
  public_profile_hint: z.string().nullable(),
  source: Source,
});

export const Extraction = z.object({
  company: Str,
  legal_name: Str,
  website: Str,
  city: Str,
  incorporation_date: Str,
  one_liner: Str,
  founders: z.array(Founder),
  equity_split: Str,
  team_composition: Str,
  outsourced_or_contract_staff: Str,
  sector_selected: Str,
  stage_selected: Str,
  raise_inr_cr: Num,
  valuation_inr_cr: Num,
  valuation_type: Str,
  traction_metrics: z.array(z.object({ metric: z.string(), value: z.string(), period: z.string().nullable(), source: Source })),
  unit_economics: z.array(z.object({ metric: z.string(), value: z.string(), source: Source })),
  repeat_retention: Str,
  credit_or_regulatory: z.array(z.object({ item: z.string(), detail: z.string(), source: Source })),
  competition_claims: z.array(z.object({ claim: z.string(), source: Source })),
  use_of_funds: Str,
  application_source: z.object({
    kind: z.enum(["cold", "warm_intro", "unknown"]),
    from_whom: z.string().nullable(),
    source: Source,
  }),
  existing_investors: Str,
  milestones_promised: z.array(z.object({ milestone: z.string(), source: Source })),
  form_deck_conflicts: z.array(
    z.object({ field: z.string(), form_says: z.string(), deck_says: z.string(), severity: z.enum(["low", "medium", "high"]) }),
  ),
  likely_sector: z.object({
    normalised: z.enum(["fintech", "deeptech", "consumer_tech", "consumer_brand", "saas", "other"]),
    business_model: z.enum(["lending", "payments", "wealth", "consumer_brand", "marketplace", "commerce_infra", "saas", "deeptech_hardware", "consumer_app", "crypto", "healthcare_services", "other"]),
    mislabel: z.boolean(),
    reason: z.string(),
  }),
  is_deeptech: z.boolean(),
  founder_email: z.string().nullable(),
});
export type ExtractionT = z.infer<typeof Extraction>;

export async function extractApplication(opts: { company: string; form?: PdfInput; deck?: PdfInput; memoText?: string; bypassCache?: boolean }) {
  const prompt = await loadPrompt("extract", { company: opts.company });
  const pdfs: PdfInput[] = [];
  if (opts.form) pdfs.push({ ...opts.form, name: "FORM: " + opts.form.name });
  if (opts.deck) pdfs.push({ ...opts.deck, name: "DECK: " + opts.deck.name });
  const extra = opts.memoText
    ? `\n\nThis is a PSEUDO-APPLICATION built from a past memo (no PDFs). Use source.file = "memo" and page = null.\n<memo_text>\n${opts.memoText}\n</memo_text>`
    : "";
  return generateJson({
    task: "extract",
    schema: Extraction,
    prompt: prompt + extra,
    pdfs,
    temperature: 0,
    bypassCache: opts.bypassCache,
  });
}

/** Deterministic post-checks on top of the LLM's own conflict list (numbers that differ between form and deck). */
export function numericConflicts(x: ExtractionT) {
  const out: Array<{ field: string; form_says: string; deck_says: string; severity: "low" | "medium" | "high" }> = [];
  const byMetric = new Map<string, { form?: string; deck?: string }>();
  for (const t of x.traction_metrics) {
    const k = t.metric.toLowerCase().replace(/[^a-z]/g, "");
    const e = byMetric.get(k) ?? {};
    if (t.source?.file === "form") e.form = t.value;
    if (t.source?.file === "deck") e.deck = t.value;
    byMetric.set(k, e);
  }
  for (const [k, e] of byMetric) {
    if (e.form && e.deck) {
      const nf = e.form.match(/[\d.,]+/)?.[0];
      const nd = e.deck.match(/[\d.,]+/)?.[0];
      if (nf && nd && nf !== nd && !x.form_deck_conflicts.some((c) => c.field.toLowerCase().replace(/[^a-z]/g, "") === k))
        out.push({ field: k, form_says: e.form, deck_says: e.deck, severity: "medium" });
    }
  }
  return out;
}
