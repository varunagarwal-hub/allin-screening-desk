import { desc, eq } from "drizzle-orm";
import { db } from "./db";
import { checks, extractions } from "./schema";
import { registerStep, latestExtraction } from "./pipeline";
import { runRules } from "./rules";
import { portfolio, portfolioFor, thesis } from "./thesis";
import { applications } from "./schema";
import { cosine, embed } from "./llm";

/** Embedding similarity of the applicant one-liner vs each portfolio one-liner (keyword check still runs without it). */
async function portfolioSimilarity(oneLiner: string | null, companies = portfolio.companies) {
  const out: Record<string, number> = {};
  if (!oneLiner) return out;
  const a = await embed(oneLiner).catch(() => null);
  if (!a) return out;
  for (const p of companies) {
    const text = p.one_liner ?? (p.site_categories ? `${p.name}: ${p.site_categories}` : null);
    if (!text) continue;
    const b = await embed(text).catch(() => null);
    if (b) out[p.name] = Number(cosine(a, b).toFixed(3));
  }
  return out;
}

registerStep("rules", async (appId) => {
  const x = await latestExtraction(appId);
  if (!x) throw new Error("run extract first");
  const [ex] = await db().select().from(extractions).where(eq(extractions.applicationId, appId)).orderBy(desc(extractions.id)).limit(1);
  const [app] = await db().select().from(applications).where(eq(applications.id, appId));
  // backtest: a memo company must not match its own (outcome-revealing) portfolio entry
  const companies = portfolioFor(app?.isBacktest ? app.company : undefined);
  const similarity = await portfolioSimilarity(x.one_liner.value, companies);
  const flags = runRules(x, {
    cfg: thesis.rules_config,
    companies,
    similarity,
    completenessNote: `Portfolio list is ${portfolio.completeness.estimate}, so an unknown overlap is possible.`,
    conflicts: (ex?.conflicts as typeof x.form_deck_conflicts) ?? x.form_deck_conflicts,
  });
  await db().delete(checks).where(eq(checks.applicationId, appId));
  if (flags.length) await db().insert(checks).values(flags.map((f) => ({ applicationId: appId, code: f.code, severity: f.severity, reason: f.reason, details: f.details ?? null })));
  return { provider: Object.keys(similarity).length ? "rules+embeddings" : "rules", summary: { flags: flags.filter((f) => f.severity !== "info").map((f) => `${f.code}:${f.severity}`) } };
});
