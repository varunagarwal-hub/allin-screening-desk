/** Past deal memos as few-shot reasoning examples (rule 13), retrieved by tag overlap + embedding similarity. */
import memosJson from "@/data/memos/memos.json";
import { cosine, embed } from "./llm";

export type Memo = {
  id: string;
  n: number;
  company: string;
  sector_raw: string;
  sector: string;
  business_model: string;
  stage: string | null;
  source: string | null;
  decision: "invested" | "passed";
  what_it_does: string;
  founder_assessment: string;
  risks: string;
  why: string;
};
export const memos = memosJson as Memo[];

export function memoAsExample(m: Memo) {
  return `### ${m.company} (${m.sector_raw}; ${m.stage}; ${m.source}) — DECISION: ${m.decision.toUpperCase()}
What it does: ${m.what_it_does}
Founder assessment: ${m.founder_assessment}
Risks: ${m.risks}
Why: ${m.why}`;
}

/** Tag score: sector and business model overlap (pure, unit-testable). */
export function tagScore(m: Memo, sector: string, model: string) {
  return (m.sector === sector ? 1 : 0) + (m.business_model === model ? 1.5 : 0);
}

/** Top-k similar memos. `excludeId` implements leave-one-out for the backtest. */
export async function similarMemos(p: { sector: string; businessModel: string; text: string }, k = 3, excludeId?: string) {
  const a = p.text ? await embed(p.text).catch(() => null) : null;
  const scored = [];
  for (const m of memos) {
    if (m.id === excludeId) continue;
    let sim = 0;
    if (a) {
      const b = await embed(m.what_it_does).catch(() => null);
      if (b) sim = cosine(a, b);
    }
    scored.push({ memo: m, score: tagScore(m, p.sector, p.businessModel) + 2 * sim, sim });
  }
  scored.sort((x, y) => y.score - x.score);
  // keep at least one invested and one passed example when possible, so the model sees both sides
  const top = scored.slice(0, k);
  if (k >= 2 && top.every((t) => t.memo.decision === top[0].memo.decision)) {
    const other = scored.find((s) => s.memo.decision !== top[0].memo.decision);
    if (other) top[k - 1] = other;
  }
  return top.map((t) => ({ ...t.memo, similarity: Number(t.score.toFixed(3)) }));
}
