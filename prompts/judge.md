An AI screening system disagreed with a venture fund's past decision. Judge, as a fair outside reviewer, whether the fund or the system was more likely wrong. Be honest: often the fund had information from the meeting that the system could not see, and sometimes the fund's own notes show doubt.

THE FUND'S MEMO (including the decision and the reason, which the system did NOT see):
{{memo}}

THE SYSTEM'S READ (made from a stripped version of the memo without the decision):
{{system}}

PARTNER NOTES CONTEXT:
{{notes}}

Return:
- `verdict`: "fund_likely_wrong" | "system_likely_wrong" | "unclear"
- `reasoning`: 2-4 sentences. Name the specific evidence. Say if the system lacked meeting-only information.
- `what_would_settle_it`: the one piece of evidence that would decide it.
