// Parses the deal-memo PDF into data/memos/memos.json (few-shot examples + backtest inputs).
// Usage: npx tsx scripts/build-memos.ts
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { extractText, getDocumentProxy } from "unpdf";

const SECTOR_MAP: Array<[RegExp, string, string]> = [
  [/deeptech/i, "deeptech", "deeptech_hardware"],
  [/fintech.*credit|credit/i, "fintech", "lending"],
  [/fintech/i, "fintech", "wealth"],
  [/web3|crypto/i, "fintech", "crypto"],
  [/consumer brand/i, "consumer_brand", "consumer_brand"],
  [/consumer tech/i, "consumer_tech", "consumer_app"],
];

(async () => {
  const buf = await readFile("data/seed/MESA_T2_Case 03_Deal Memos.pdf");
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(buf)), { mergePages: true });
  const flat = (Array.isArray(text) ? text.join("\n") : text).replace(/\r/g, "");
  const parts = flat.split(/Memo (\d+): /).slice(1);
  const memos = [];
  for (let i = 0; i < parts.length; i += 2) {
    const n = Number(parts[i]);
    const body = parts[i + 1];
    const company = body.split("\n")[0].trim().replace(/\s+Sector:.*$/, "");
    const hdr = body.match(/Sector:\s*([\s\S]*?)\s*\|\s*Stage:\s*([\s\S]*?)\s*\|\s*Source:\s*([\s\S]*?)\s*\|\s*Decision:\s*(INVESTED|PASSED)/);
    const sec = (re: RegExp) => (body.match(re)?.[1] ?? "").replace(/\s+/g, " ").trim();
    const what = sec(/What it does\.\s*([\s\S]*?)Founder assessment\./);
    const founder = sec(/Founder assessment\.\s*([\s\S]*?)Risks and open questions\./);
    const risks = sec(/Risks and open questions\.\s*([\s\S]*?)Why we (?:invested|passed)\./);
    const why = sec(/Why we (?:invested|passed)\.\s*([\s\S]*?)$/);
    const sectorRaw = hdr?.[1]?.replace(/\s+/g, " ") ?? "";
    const m = SECTOR_MAP.find(([re]) => re.test(sectorRaw));
    memos.push({
      id: `memo${n}`,
      n,
      company,
      sector_raw: sectorRaw,
      sector: m?.[1] ?? "other",
      business_model: m?.[1] === "deeptech" ? "deeptech_hardware" : /retail|delivery/i.test(sectorRaw) ? "commerce_infra" : /exam/i.test(sectorRaw) ? "consumer_app" : m?.[2] ?? "other",
      stage: hdr?.[2]?.trim() ?? null,
      source: hdr?.[3]?.replace(/\s+/g, " ").trim() ?? null,
      decision: hdr?.[4] === "INVESTED" ? "invested" : "passed",
      what_it_does: what,
      founder_assessment: founder,
      risks,
      why: why.replace(/MESA MBA C4[\s\S]*$/, "").trim(),
    });
  }
  await mkdir("data/memos", { recursive: true });
  await writeFile("data/memos/memos.json", JSON.stringify(memos, null, 2));
  console.log(memos.map((m) => `${m.n} ${m.company} | ${m.sector}/${m.business_model} | ${m.stage} | ${m.decision} | why ${m.why.length}c`).join("\n"));
})();
