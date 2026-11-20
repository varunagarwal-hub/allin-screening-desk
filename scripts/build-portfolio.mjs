// Builds data/thesis/portfolio.json from verified sources (Phase 1). Re-run after editing the lists.
import fs from "node:fs";

const ACC = "2026-11-20";
const SITE = "https://www.allincapital.vc/portfolio";

function norm(c) {
  c = (c || "").toLowerCase();
  if (/deeptech|space/.test(c)) return "deeptech";
  if (/fintech/.test(c)) return "fintech";
  if (/saas|dev tools|generative ai|b2b marketplace|manufacturing/.test(c)) return "saas_b2b";
  if (/d2c|consumer brand/.test(c)) return "consumer_brand";
  if (/consumer|gaming|social|healthcare|edtech|travel|agritech/.test(c)) return "consumer_tech";
  return "unknown";
}
const site = (fund, rows) =>
  rows.map(([name, cats]) => ({
    name, fund, site_categories: cats, one_liner: null, sector: norm(cats),
    source_url: SITE, source_date: "undated", accessed: ACC, verified: "fetched via Jina Reader 2026-11-20",
  }));

const fund2 = [["Tross","Healthcare"],["SuperLiving","Consumer Tech"],["Taakat","Consumer Brand"],["Medmitra AI","SAAS"],["Ionic","Consumer Brand"],["Spill Games","Consumer Tech"],["Krvvy","Consumer Brand"],["NPrep","Consumer Tech"],["Mixar","SAAS"],["Plazza","Consumer Tech"],["Cherry","Consumer Tech"],["Returns","FinTech"],["MomsMade","Consumer Brand"]];
const fund1 = [["NewMe","India Consumer"],["PierSight","DeepTech,Space"],["MeetRecord","SAAS"],["Broccoli AI",null],["Potpie",null],["Volt","FinTech"],["Vaaree","India Consumer"],["Hotelzify","Travel,SAAS"],["SuperSnd","SAAS"],["Magma","B2B Marketplace"],["SuperNova","EdTech"],["Sketchnote","SAAS"],["GloRoots","SAAS"],["Suite42","B2B Marketplace"],["Produze","B2B Marketplace"],["Rocketpay","FinTech"],["EximFiles","SAAS"],["SalesMonk","SAAS"],["GigaFun Studios","Gaming"],["Dashwave","Dev Tools"],["MoMoney","FinTech"],["Hectar","B2B Marketplace"],["Knot","Social,Consumer Internet"],["Mannjal","FinTech"],["Nawgati","SAAS,Climate"],["FanTail","B2B Marketplace"],["DressFolk","India Consumer,D2C"],["DevDham","India Consumer"],["REint","SAAS,Climate"],["Segmind","SAAS,Dev Tools,Generative AI"],["Arva","India Consumer,Healthcare"],["Salty","D2C,India Consumer"],["Nirmaan","B2B Marketplace"],["Karban","India Consumer,DeepTech"],["Mave Health","India Consumer,Healthcare"],["Trisu","India Consumer,D2C"],["Grid","Manufacturing,B2B Marketplace"],["FuturElectra","EV,FinTech"],["BindBee","SAAS,Dev Tools"],["Prosparity","EV,FinTech"],["MagicStudio","Generative AI,SAAS"],["Everyday","India Consumer"],["Creatr","Generative AI,SAAS"],["TractorFactory","India Consumer,AgriTech"],["Viralme","B2B Marketplace"],["CommandK","Dev Tools"],["Spiti","SAAS"],["Suitable","SAAS"],["Piiko","Healthcare"],["Vivahit","India Consumer"],["Fijit","Gaming"]];

// One-liners only where a source we have describes the business.
const oneLiners = {
  MeetRecord: "Records and summarises online sales meetings and calls for sales/CS teams (conversation intelligence, meeting notes).",
  Spiti: "Internal video hub for remote teams.",
  Suitable: "One-click employee referral requests for recruiters.",
  "Medmitra AI": "Health technology platform (AI).",
  "Spill Games": "Mobile game studio.",
  Mixar: "AI animation company.",
  Krvvy: "Shapewear label.",
  Taakat: "Packaged consumer goods brand.",
  Arva: "Fertility care: at-home AMH tests and clinics.",
  "Mave Health": "Mental-health technology.",
  TractorFactory: "Used and electric tractor marketplace (Jabalpur).",
  Volt: "Loans against mutual funds.",
  DressFolk: "Handloom clothing brand.",
  Tross: "Healthcare infrastructure SaaS.",
  PierSight: "Space / satellite company.",
};

const port = [...site("Fund 2", fund2), ...site("Fund 1", fund1)].map((p) => (oneLiners[p.name] ? { ...p, one_liner: oneLiners[p.name] } : p));

const memo = [
  ["ePlane", "eVTOL aircraft and UAVs for intracity travel.", "deeptech", "Memo 1"],
  ["Unbox Robotics", "AI-assisted robotic package-sorting systems for warehouses.", "deeptech", "Memo 3"],
  ["Wint Wealth", "Platform making bonds / fixed income accessible to retail investors.", "fintech", "Memo 5"],
  ["Giva", "Online-first fine silver jewellery brand.", "consumer_brand", "Memo 7"],
  ["SuperK", "Tech-enabled small-town grocery retail network (rebranded kiranas).", "consumer_tech", "Memo 9"],
  ["Jai Kisan", "Financing for farmers and rural households.", "fintech", "Memo 11"],
].map(([name, one_liner, sector, m]) => ({
  name, fund: "unknown (past portfolio)", site_categories: null, one_liner, sector,
  source_url: `data/seed/MESA_T2_Case 03_Deal Memos.pdf#${m}`, source_date: "case pack 2026-11-12", accessed: ACC,
  verified: "case memo (decision: INVESTED)",
}));

const press = [
  ["Rocketlane", "Customer onboarding and implementation software.", "saas_b2b", SITE],
  ["Bitespeed", "eCommerce marketing / automation software.", "saas_b2b", SITE],
  ["Mailmodo", "No-code interactive email marketing platform.", "saas_b2b", SITE],
  ["FleetX", "AI and sensor-driven fleet management SaaS.", "saas_b2b", SITE],
  ["Fashinza", "Managed marketplace for the fashion supply chain.", "saas_b2b", SITE],
  ["RevenueHero", "Helps sales reps prioritise accounts most likely to convert.", "saas_b2b", SITE],
  ["Anar", "B2B network for SMEs in manufacturing, retail and reselling.", "saas_b2b", SITE],
  ["Rigi", "Platform for creators to run paid communities.", "consumer_tech", SITE],
  ["QuestBook", "Web3 learning platform.", "crypto_web3", SITE],
  ["&Done", "Haircare brand.", "consumer_brand", "https://scoopearth.com/done-secured-%E2%82%B96-5-crore-in-a-pre-seed-funding-round-led-by-all-in-capital/"],
  ["CUNIN", "Lifestyle brand.", "consumer_brand", "https://entrackr.com/snippets/cunin-raises-450k-pre-seed-round-co-led-by-all-in-capital-and-huddle-ventures-12130343"],
  ["Iztri", "Fabric care startup (Bengaluru).", "consumer_tech", "https://entrackr.com/snippets/fabric-care-startup-iztri-raises-seed-round-led-by-all-in-capital-suashish-group-12506395"],
].map(([name, one_liner, sector, url]) => ({
  name, fund: "unknown", site_categories: null, one_liner, sector, source_url: url, source_date: "undated", accessed: ACC,
  verified: "reported by research agent 2026-11-20; not in the portfolio page text fetched today (possibly in the collapsed 'Past Portfolio Companies' section). Treat as probable.",
}));

const byName = new Map();
for (const p of [...port, ...memo, ...press]) {
  const k = p.name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!byName.has(k)) byName.set(k, p);
}

fs.writeFileSync(
  "data/thesis/portfolio.json",
  JSON.stringify(
    {
      generated: ACC,
      completeness: {
        estimate: "partial (~60-75%)",
        detail:
          "The fund's portfolio page lists 64 companies (13 Fund 2, 51 Fund 1) plus a collapsed 'Past Portfolio Companies' section we could not read. The FAQ (allincapital.vc/apply_now) says '100+ teams'; third-party trackers report 65-109 investments. Added: 6 memo companies and 12 press-reported companies. Missing entries mean the conflict check can miss overlaps, so a clean result is reported as 'no conflict with KNOWN portfolio', never 'no conflict'.",
        one_liners: "Most site entries show only a category. The conflict check uses category plus name, and one-liners appear only where a source describes the business.",
      },
      companies: [...byName.values()],
      partner_notes: [
        { name: "MeetRecord", note: "Named in Partner Meeting 4 as an existing portfolio company; meeting-notes / call-summary startups overlap with it.", source_url: "data/seed/MESA_T2_Case 03_Partner Meeting Notes.pdf#Meeting 4" },
      ],
    },
    null,
    2,
  ),
);
console.log("portfolio entries:", byName.size);
