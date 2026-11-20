// Builds data/thesis/thesis.json (Phase 1) from public sources + the revealed/criteria draft.
import fs from "node:fs";

const ACC = "2026-11-20";
// revealed_thesis + criteria are hand-written from the memos; after the first build they live in thesis.json itself.
const draft = JSON.parse(fs.readFileSync("data/thesis/thesis.json", "utf8"));
const FAQ = "https://www.allincapital.vc/apply_now";
const INC42_F2 = "https://inc42.com/buzz/all-in-capital-launches-inr-200-cr-fund-ii";
const ISN_F2 = "https://indianstartupnews.com/funding/all-in-capital-launches-rs-200-crore-second-fund-secures-rs-85-crore-in-first-close-8872954";
const INC42_FMF = "https://inc42.com/features/kushal-baghia-all-in-capital-founder-market-fit-framework-pre-seed-investing";
const INC42_F1 = "https://inc42.com/buzz/all-in-capital-sets-up-10-mn-fund-to-back-homegrown-early-stage-startups";
const GT = "https://india.entrepreneur.com/news-and-trends/all-in-capital-launches-golden-ticket-program-for/502479";
const TORQ = "https://entrackr.com/snippets/all-in-capital-launches-torqlabs-for-supply-chain-and-logistics-startups-9651748";

const VERIFIED = "fetched by us via Jina Reader 2026-11-20";
const AGENT = "found by research agent 2026-11-20 (page summary); spot-check before quoting";

const thesis = {
  generated: ACC,
  fund: { name: "All In Capital", city: "Mumbai", partners: ["Kushal Bhagia", "Aditya Singh"], site: "https://www.allincapital.vc" },
  written_thesis: {
    summary:
      "Pre-seed and seed fund backing Indian founders. Fund II (2025) names four focus areas: consumer tech, deeptech, fintech and consumer brands, while calling itself sector-agnostic. Typical first cheque USD 250-500K (Fund II: INR 2-5 Cr). Leads or co-leads rounds under USD 1M. Selects on founder-market fit.",
    sectors: {
      value: ["fintech", "deeptech", "consumer_tech", "consumer_brand"],
      note: "Fund II says 'sector agnostic with a special focus on' these four. Fund I (2022) was sector-agnostic, and its live portfolio is heavily B2B SaaS / marketplaces. 2025-26 programmes add AI / vertical SaaS (Golden Ticket) and supply chain / logistics (TorQLabs).",
      sources: [
        { url: INC42_F2, date: "2025-03-20", excerpt: "sector agnostic ... special focus on consumer tech, deeptech, fintech, and consumer brands", verified: AGENT },
        { url: ISN_F2, date: "2025-03-20", excerpt: "consumer tech, deeptech, fintech, and consumer brands", verified: AGENT },
        { url: INC42_F1, date: "2022-06-09", excerpt: "The sector-agnostic fund will invest between $100K to $500K in pre-seed and seed funding rounds", verified: AGENT },
      ],
    },
    adjacent_programmes: [
      { name: "Golden Ticket", claim: "Up to USD 300K pre-seed for AI-led and vertical SaaS startups with a technical co-founder.", url: GT, date: "2026-02-05", verified: AGENT },
      { name: "TorQLabs", claim: "Pre-seed platform for supply chain, logistics, mobility and smart-warehousing startups.", url: TORQ, date: "2025-08-12", verified: AGENT },
    ],
    stage: {
      value: ["pre-seed", "seed"],
      note: "Ready at paper-plan, MVP or early-revenue stage. The fund avoids revenue-stage rounds because its cheques are small.",
      sources: [
        { url: FAQ, date: "undated", excerpt: "We are a pre-seed and seed stage fund that backs the best founders from India!", verified: VERIFIED },
        { url: INC42_FMF, date: "2023-03-09", excerpt: "All In Capital invests at the pre-seed stage", verified: AGENT },
      ],
    },
    cheque: {
      value: { usd_min: 250000, usd_max: 500000, inr_cr_min: 2, inr_cr_max: 5 },
      note: "The FAQ says USD 250-500K in the first round. Fund II press says INR 2-5 Cr. Older figures: USD 100-500K (2022), average USD 150K (2023).",
      sources: [
        { url: FAQ, date: "undated", excerpt: "We typically invest $250 to $500K in your first round.", verified: VERIFIED },
        { url: ISN_F2, date: "2025-03-20", excerpt: "Rs 2 crore to Rs 5 crore", verified: AGENT },
      ],
    },
    round_behaviour: {
      value: "Leads or co-leads rounds under USD 1M. Above USD 1M, commits first and helps find a lead.",
      sources: [{ url: FAQ, date: "undated", excerpt: "If you are raising under $1M we can lead or co-lead your round", verified: VERIFIED }],
    },
    fund_size: {
      value: "Fund I USD 10M (2022), about USD 11M deployed across 51 startups. Fund II target INR 200 Cr plus INR 100 Cr greenshoe, INR 85 Cr first close (2025).",
      sources: [
        { url: INC42_F1, date: "2022-06-09", excerpt: "The fund will be investing in 75-100 startups in the next three years", verified: AGENT },
        { url: INC42_F2, date: "2025-03-20", excerpt: "up to INR 5 Cr each", verified: AGENT },
      ],
    },
    founder_criteria: {
      value: [
        "Founder-market fit: what the founders know and can or cannot do, the key risk, and their 'earned secrets'.",
        "First-time founders need proven ability to build; long shared work history is favoured.",
        "Contrarian bets and high selectivity (300-500 deals a month, two or three picked).",
        "'All in' founders: the fund is ready the day the founder commits full-time.",
      ],
      sources: [
        { url: INC42_FMF, date: "2023-03-09", excerpt: "It's about what the founders know and what they can do or can't do.", verified: AGENT },
        { url: INC42_FMF, date: "2023-03-09", excerpt: "What is the key risk and what are their earned secrets?", verified: AGENT },
        { url: FAQ, date: "undated", excerpt: "the day you decide to go All In on your startup - we are ready", verified: VERIFIED },
      ],
    },
    geography: {
      value: "India-founded startups building for India and the world.",
      sources: [{ url: INC42_F1, date: "2022-06-09", excerpt: "homegrown startups that are building products and services for India as well as the world", verified: AGENT }],
    },
    ownership_target: { value: "not_public", note: "No public ownership target was found. The FAQ says the fund usually invests on a convertible note." },
  },
  anti_thesis: {
    value: "not_public",
    searched: ["allincapital.vc homepage, /portfolio, /apply_now", "Inc42 2022 and 2023 articles", "Fund II press (Inc42, Entrackr, Indian Startup News, Outlook Business)", "Golden Ticket and TorQLabs coverage", "web searches for exclusions and crypto"],
    what_absence_costs:
      "With no published exclusion list, any 'outside thesis' flag rests on (a) the four named focus sectors and (b) the memos' revealed behaviour (Coinlane, a crypto exchange, was declined as 'outside the areas we back'). Note that the public portfolio includes QuestBook (a Web3 learning platform), so 'crypto is excluded' is NOT a public rule. The system therefore treats exclusions as revealed-thesis inference, flags them with medium rather than critical severity, and always sends them to Kushal. It can never auto-decline.",
    revealed_exclusions: [
      { pattern: "Businesses whose existence depends on favourable regulatory change (e.g. retail crypto trading)", memo: "Memo 10: Coinlane" },
      { pattern: "Models needing density/capex capital far beyond a pre-seed cheque (structure pass)", memo: "Memo 4: HopBox" },
    ],
  },
  revealed_thesis: draft.revealed_thesis,
  drift_note:
    "Written vs revealed already differ. Public wording names four sectors, but the live portfolio is heavily B2B SaaS / marketplaces, and the memo yeses include small-town retail (SuperK) and rural credit (Jai Kisan), which sit at the edge of the labels. Partners disagree on whether this is drift or a pipeline change (Partner Meeting 5). Every score therefore states whether the written or the revealed thesis drove it.",
  criteria: draft.criteria,
  rules_config: {
    preseed_raise_ok_inr_cr: 8.5,
    preseed_raise_stretch_inr_cr: 20,
    fund_cheque_inr_cr: [2, 5],
    stage_ok: ["pre-seed", "preseed", "seed", "angel", "idea", "pre seed"],
    stage_mismatch: ["series a", "series b", "series c", "growth", "pre-series a", "bridge"],
    note: "USD 1M is about INR 8.5 Cr, the fund's lead/co-lead ceiling. Raises up to INR 20 Cr are flagged as a stretch. Above that, or a Series A label, is a mismatch.",
  },
};
fs.writeFileSync("data/thesis/thesis.json", JSON.stringify(thesis, null, 2));
console.log("thesis.json written:", thesis.revealed_thesis.length, "revealed patterns,", thesis.criteria.length, "criteria");
