# All In Capital: screening desk

First-pass triage for All In Capital's inbound pre-seed applications (Mesa Term 2, Case 3). For each application in a week's intake, the desk gives:

- a criterion-by-criterion read against the fund's thesis,
- the source behind every claim,
- what it could not find,
- whether to take the call.

**It never decides.** Kushal accepts or overrides every outcome. Corrections are reused for similar companies (Loop 1). Riya's email edits teach the drafter (Loop 2). Once a call is approved, a scheduling agent handles the email and calendar back-and-forth.

## Run it

```bash
npm install --ignore-scripts      # --ignore-scripts avoids a Windows esbuild postinstall issue in drizzle-kit
cp .env.example .env.local        # fill in keys (see "Keys")
npm run db:migrate                # applies drizzle/*.sql to Neon
npm run dev                       # http://localhost:3000
```

1. **Intake** (`/intake`): press **Run now** to load the 10 seed applications from `data/seed/`, or upload form + deck PDFs. Files are paired by company name.
2. **Batch** (`/`): press **Run pipeline for all**. Each application runs one step per request (extract → rules → research → founder → score), and status is visible per step.
3. Open an application to review it, then **Accept** or **Override** (an override needs a one-line reason). Add **call notes** after the call.
4. **Outreach** (`/outreach`): draft, edit and approve the invite or pass note. Then use **Check replies** to let the agent book the call.
5. **Evals** (`/evals`) and **Trust report** (`/trust`, exportable as Markdown).

CLI equivalents:

| Command | What it does |
|---|---|
| `npx tsx scripts/run-pipeline.ts seed` | load seed applications |
| `npx tsx scripts/run-pipeline.ts run all [steps…]` | run pipeline steps for every application |
| `npx tsx scripts/evals.ts lock` | lock the pre-registered thresholds (done before the first eval) |
| `npx tsx scripts/evals.ts backtest-create` then `… backtest cold` | leave-one-out memo backtest |
| `npx tsx scripts/loop-proof.ts` | record partner decisions, then re-score warm |
| `npx tsx scripts/evals.ts claims\|fabrication\|email\|booking\|judge\|stability\|report` | individual evals |
| `npx tsx scripts/loop1-acceptance.ts [reset]` | Phase 7 acceptance: an override on one lending app changes another on re-score |
| `npm test` | unit tests (rules, pairing, slots, traceability, anti-fabrication, timezone maths, …) |

## Keys (all free tiers)

| Var | Where / note |
|---|---|
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_MODEL_LITE` | <https://aistudio.google.com/apikey>. Defaults are `gemini-3.8-flash` (reasoning steps) and `gemini-3.5-flash-lite` (classification and quota fallback). Check which models your key can use with `npx tsx scripts/list-gemini-models.ts`. |
| `GROQ_API_KEY`, `GROQ_MODEL` | <https://console.groq.com/keys>. Default `openai/gpt-oss-120b`. Text only: PDFs fall back to extracted text. |
| `TAVILY_API_KEY` | <https://app.tavily.com>. The desk uses at most 8 calls per application; cached hits are free. |
| `DATABASE_URL` | Neon pooled connection string |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `FUND_SENDER_EMAIL` | See "Google OAuth" below. If these are missing, a DB-backed mock mailbox and calendar are used. |
| `KUSHAL_CALENDAR_ID`, `ADITYA_CALENDAR_ID` | `primary`, plus a second calendar standing in for Aditya |
| `DEMO_MODE`, `DEMO_FOUNDER_EMAIL` | With `DEMO_MODE=true`, every founder-bound email goes to `DEMO_FOUNDER_EMAIL` (your second Gmail, playing the founder) |
| `CRON_SECRET` | Long random string. Vercel Cron sends it as a Bearer token. |

### Google OAuth (client + refresh token)

1. Go to <https://console.cloud.google.com>, then create or select a project.
2. Enable the **Gmail API** and the **Google Calendar API**.
3. Configure the consent screen (Google Auth Platform):
   - **Workspace account** (e.g. a school domain): choose **Internal**. No test users or verification are needed, and the refresh token does not expire after 7 days.
   - **Personal Gmail**: choose **External**, add scopes `gmail.send`, `gmail.modify`, `calendar.events` and `calendar.readonly`, and add the sender as a test user. In Testing mode the refresh token expires after 7 days.
4. Create an OAuth client of type **Desktop app**. Put its ID and secret in `.env.local`.
5. Run `npm run google:token`, open the printed URL as the sender account, and approve. Copy the printed `GOOGLE_REFRESH_TOKEN` into `.env.local`.
6. Create a second calendar (e.g. "Aditya (demo)") and put its ID in `ADITYA_CALENDAR_ID`.

## Architecture

- Next.js 16 (App Router, `cacheComponents`), TypeScript, Tailwind 4.
- Neon Postgres with Drizzle ORM, deployed on Vercel Hobby.
- Every external call goes through a small module in `lib/`, every LLM output is Zod-validated JSON (retry once, then the step is marked failed and shown), and every LLM and research response is cached in Postgres by input hash.

```
lib/
  llm.ts            Gemini main -> Gemini lite (429 back-off) -> Groq; Zod validation; embeddings; cache
  research.ts       Tavily (budgeted), Google News RSS, Jina Reader (robots.txt, never LinkedIn), source tiers
  intake.ts pdf.ts  pairing, PDF storage in Postgres (no disk on Vercel), text for the Groq fallback
  extract.ts        Phase 2: structured extraction with per-field source (file + page) and form-vs-deck conflicts
  rules.ts          Phase 3: deterministic checks (stage/cheque, portfolio conflict, sector, missing numbers, routing)
  research-agent.ts Phase 4: fixed research plan + claim check; citations enforced in code
  founder.ts        Phase 5: founder file (10 signals present/absent/unknown with evidence; call-only markers)
  memos.ts          past memos as few-shot examples, retrieved by tags + embeddings
  scorer.ts         Phase 6: 7 criteria, thesis basis, gaps, memory influence; traceability enforced in code
  memory.ts         Loop 1: decisions -> decision_memory -> retrieval; calibration proposals and approvals
  callnotes.ts      call notes -> founder file + re-score -> stored as a Loop 1 correction
  drafts.ts         Phase 8a + Loop 2: drafts, Riya's edit gate, edit distance + edit types, sending
  slots.ts          Phase 8b: free/busy, Tue/Thu 14-18 IST holds (DB-unique), 72h expiry, booking with Meet
  scheduler-agent.ts Phase 8d-f: reply polling (exactly once), intent (untrusted text), act / escalate / 3-round cap
  gmail.ts calendar.ts  Google or DB mock behind the same interfaces; DEMO_MODE redirect
  evals.ts          Phase 9: backtest (leave-one-out), sourcing, fabrication, stability, email intent, double booking, trust report
prompts/            one file per prompt
data/thesis/        thesis.json (written + revealed + criteria) and portfolio.json, every entry sourced
data/memos/         memos parsed from the case PDF (few-shot + backtest)
data/evals/         pre-registered thresholds (hash-locked) and 15 email-reply fixtures
```

## Components map

| # | Lane | What happens | Where |
|---|---|---|---|
| 1 | **Riya** | Uploads the week's PDFs or presses Run now; runs the pipeline | `/intake`, `/` |
| 2 | **Gemini read** | PDFs sent natively; structured facts with source file and page; form-vs-deck conflicts; sector mislabel | `lib/extract.ts`, `prompts/extract.md` |
| 3 | **Rule checker** | Deterministic flags with severity and a plain-English reason | `lib/rules.ts`, `lib/steps-rules.ts` |
| 4 | **Research** | Identity, founders, competitors, funding, regulation; claim check; "could not find" list | `lib/research-agent.ts`, `lib/research.ts` |
| 5 | **Founder file** | Rewarded and penalised signals with evidence; call questions | `lib/founder.ts` |
| 6 | **Thesis pack** | Written thesis (sourced), revealed thesis (memo-cited), anti-thesis (`not_public`), 7 criteria, portfolio | `data/thesis/*.json` |
| 7 | **Memory** | Decision memory (tags + embeddings), approved calibration notes, draft memory | `lib/memory.ts`, `lib/drafts.ts` |
| 8 | **Scorer** | 7 criteria 1-5 with evidence, gaps, thesis basis, memory influence; take_call / hold / pass | `lib/scorer.ts` |
| 9 | **Kushal gate** | Accept or override (with a one-line reason); nothing is auto-decided | `/apps/[id]` |
| 10 | **Drafter** | Invite, deeptech invite or kind pass note, using Riya's last approved examples | `lib/drafts.ts` |
| 11 | **Riya edit gate** | Edits and approves; edit distance and edit types are stored | `/outreach`, `/apps/[id]` |
| 12 | **Gmail** | Sends from the fund account; thread ids stored; replies read by thread | `lib/gmail.ts` |
| 13 | **Email agent** | Classifies replies (untrusted) and books, re-offers or escalates | `lib/scheduler-agent.ts` |
| 14 | **Calendar** | Free/busy for Kushal (+ Aditya for deeptech), HOLD events, Meet booking | `lib/calendar.ts`, `lib/slots.ts` |
| 15 | **Database / evals** | Neon tables, cache, audit log; pre-registered evals and trust report | `lib/schema.ts`, `lib/evals.ts` |

## The loops

- **Loop 1 (Kushal's reasons → decision memory → scorer).** Every accept or override is stored with sector, business model, multi-label business type (lending, consumer brand, SaaS, deeptech) and the criteria changed. New applications retrieve the closest entries, and the scorer must state when one moved a score (`memory_influence`). When 3+ corrections share a pattern, a calibration note is proposed; only notes Kushal approves reach the scorer. Call notes rebuild the founder file, re-score, and store any change as a correction.
- **Loop 2 (Riya's edits → draft memory → drafter).** Each approved email stores draft, final, word-level edit distance and edit types (tone, length, specificity of reason, factual fix…). New drafts include Riya's last 2-3 approved examples of the same type. `/outreach` shows the edit-distance trend per type.
- **Scheduling loop (reply → free/busy → book or 3 new slots).**
  - Accept a slot: re-check, book with Meet, release the other holds, confirm.
  - Propose a time: book it if it fits the rules and is free; otherwise send 3 new holds (next round).
  - Ask for options: send 3 new holds.
  - Question, decline, or embedded instructions: escalate to Riya with a suggested reply.
  - After 3 rounds without agreement: escalate.
  - With **Auto-handle** off, every agent reply waits for Riya.

## Free-tier notes

- **Gemini.** Free-tier caps are per project (see AI Studio). Mitigations: the cache, one request per step, the lite model for classification, a 429 back-off, and Groq as a last resort. A full run of 10 applications is about 50 LLM calls; the 12-memo backtest is about 36 more.
- **Groq.** Its free tier has a small tokens-per-minute cap, so very large scorer prompts can be rejected (413). That is why Gemini retries first.
- **Tavily.** 6-7 calls per application, so 10 applications use about 70 of the monthly free credits.
- **Vercel Hobby.** Functions use `maxDuration` 60s (every step fits). Cron runs at most daily, so the **Check replies** button is the main trigger.
- **Neon.** Within the free 0.5 GB; PDFs are stored in Postgres (about 1.3 MB for the seed batch).

## Known limitations

- The 10 applicants are fictional (`.example` domains), so research mostly finds "no public trace". Confidence drops, and founder signals are often "unknown" or "judge on call".
- The portfolio list is about 60-75% complete. A clean conflict check means "no conflict with the KNOWN portfolio".
- There is no public anti-thesis. Exclusions are inferred from memo behaviour, are flagged and never auto-declined.
- The backtest uses memo text written after meeting the founders (richer than a real first pass), and web research is disabled for those real companies to avoid outcome leakage. Expect live agreement to be lower.
- Embedding similarity uses Gemini embeddings stored as JSON (fine at this scale; use pgvector beyond a few thousand rows).
- The manual spot check of 10 cited sources must be completed by a person on `/evals`. Fictional applicants produced fewer than 10 cited URLs in the seed batch.
