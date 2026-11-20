# Trust report: All In Capital screening desk

Generated 2026-11-20T13:04:45.073Z. Thresholds pre-registered 2026-11-20T10:30:00+05:30; locked 2026-11-20T08:45:20.550Z (hash 6560c1e40c41…, unchanged).

## Thresholds
| Threshold | Rule | Result | Status |
|---|---|---|---|
| Decision agreement | >= 9 of 12 (hold counts as 'not take_call') | 10/12 | PASS |
| Claims sourced | 100% of claims | 100% of 141 | PASS |
| Fabricated sources | 0 cited URLs not retrieved in that run (automated) + manual spot check of 10 with 0 failures | 0 of 9 cited; spot check 0/10 done | PENDING |
| Score stability | max spread <= 1 point per criterion across 3 runs | max spread 1 | PASS |
| Email intent | >= 13 of 15 sample replies | 15/15 | PASS |
| Double bookings | 0 | 0 real, 0 duplicate offers in sim | PASS |

## Backtest (leave-one-out, cold 2026-11-20T10:15)
| # | Company | Fund | System | Agree |
|---|---|---|---|---|
| 5 | Wint Wealth | invested | hold | **no** |
| 6 | CampusCredit | passed | pass | yes |
| 4 | HopBox | passed | pass | yes |
| 9 | SuperK | invested | take_call | yes |
| 1 | The ePlane Company | invested | take_call | yes |
| 8 | AeroDrop | passed | pass | yes |
| 11 | Jai Kisan | invested | hold | **no** |
| 2 | Petalry | passed | pass | yes |
| 3 | Unbox Robotics | invested | take_call | yes |
| 7 | Giva | invested | take_call | yes |
| 10 | Coinlane | passed | pass | yes |
| 12 | Prepnest | passed | pass | yes |

## Disagreements: who was likely wrong
### Wint Wealth: fund invested, system hold → unclear
The fund made a qualitative bet on Ajinkya Kulkarni's hands-on customer empathy and trust-building instincts revealed in founder meetings, which the system could not observe. However, the system's skepticism is supported by partner Riya's explicit note on thesis drift regarding 'founder-led fixed income' investments and unaddressed risks like portfolio overlap with Volt and debt default liabilities.
*What would settle it:* Subsequent commercial performance and default-rate data showing whether Wint Wealth successfully scaled its retail distribution without conflicting with Volt or incurring debt default liabilities.

### Jai Kisan: fund invested, system hold → system likely wrong
The AI system placed the deal on hold primarily to clarify balance sheet default risk and scored risk ownership low at 2. However, the fund's partner meeting explicitly tackled this exact question in depth, determining directly from founder behavior that they treated credit risk as their own. Because the system lacked this crucial meeting-only discussion that resolved its primary objection, its hold recommendation was misplaced.
*What would settle it:* Loan book default rates and whether balance-sheet risk ultimately impaired Jai Kisan's unit economics.

## Loop proof
- Agreement with the fund, cold (no memory): 10/12; warm (after corrections): 11/12.
- Riya's edit distance (invite): first half avg 0 words, later half avg - words (n=1).
- Riya's edit distance (deeptech_invite): first half avg 0 words, later half avg - words (n=1).
- Recommendation consistency across 3 runs: 9/10 applications got the same call every time; flipped: CAPilot (take_call, pass, pass). Treat these as borderline and read the detail view.

## Where it breaks
- **No public trace for fictional or very new founders.** All 10 applicants use .example domains and placeholder LinkedIn URLs, so research reports "no public trace", and confidence and the founder score fall. The system says so; it does not fill gaps.
- **Thin decks.** When numbers appear only in the form (or nowhere), the scorer can only penalise the gap; it cannot judge quality.
- **Thesis drift.** The written thesis (four sectors) and the revealed thesis (founder behaviour over sector label; commerce infra and repeat-led consumer) disagree on edge cases. Every score states which drove it, but Kushal must decide which one the fund means.
- **Signals visible only on a call.** Defensiveness, candour about failure, and real risk ownership are marked "judge on call"; the first-pass score is provisional until call notes are added.
- **Incomplete portfolio list, and false flags.** The conflict check covers the known ~60-75% of the portfolio; a clean result means "no conflict with known portfolio". It also errs towards false flags by design (Kushal prefers them): e.g. in the backtest, Wint Wealth (retail bonds) was flagged against Volt (loans against mutual funds), which contributed to a wrong hold.
- **Borderline calls can flip.** Criterion scores were stable within 1 point, but an application near the take_call/pass line can change recommendation between runs (see stability). The cache returns the first answer for identical inputs, so the UI is consistent, but the underlying call is uncertain.
- **No public anti-thesis.** Exclusions (e.g. crypto) come from memo behaviour, not a published list, so they are flagged for Kushal rather than auto-declined.
- **Backtest limits.** Memo companies are real, so web research is disabled in the backtest to avoid outcome leakage; memo founder text was written after meeting the founders, so it is richer than a real first-pass file. Expect live agreement to be lower than backtest agreement.

## Time per application
- Before: ~30 min of Riya's time per application (case brief).
- After: ~2.7 min of unattended machine time (avg over 10 apps) + an estimated ~5 min of Riya's review. Before: Riya's ~30 min manual first pass (case brief). After: machine time runs unattended; Riya's estimated review time is reading the 2-minute detail view plus approving one email (~5 min, an estimate to be measured in pilot).
