# invoicelint 0.1.0 — test run on 36 generated invoices (2026-11-10)

All businesses, names and GST/HST numbers are fictional. GST/HST numbers were generated
with valid check digits, except where a case deliberately breaks one.

## Result
- **30/30** main invoices (`invoices/`) matched the hand-checked expected result (`expected.json`).
  10 clean invoices across ON, AB, NS, BC, QC, 17 common mistakes, 3 edge cases.
- **Messy input** (`edge/`): comma amounts ("12,500.00"), numbers instead of strings, a GST/HST
  number typed with spaces and lowercase "rt", and a Peppol-style UBL XML invoice all parsed correctly.
  Broken JSON, an impossible date and a 3-decimal amount were rejected with clear messages and exit code 2.

## Gaps found (all pass as ✓ OK today)
| File | Problem a bookkeeper would spot | Why invoicelint misses it |
|---|---|---|
| edge/g-hst-on-groceries.json | HST charged on zero-rated groceries as well as taxable items | CA-MATH-004 only fires when *every* line is exempt/zero-rated; nothing compares taxableAmount to the taxable lines |
| edge/h-ontario-charging-gst-only.json | Ontario supplier charges 5% GST instead of 13% HST | Rate checks don't use supplier.province (no place-of-supply logic) |
| invoices/29-ns-15-in-2026.json | Nova Scotia supplier still charging the old 15% in 2026 | 15% is valid in NB/NL/PE, and place of supply isn't determined |
| edge/b-negative.json | Negative total (a refund) treated as a normal tier-1 invoice | No check for negative totals; refunds behave like credit notes |

Minor: PARSE-005 for a 3-decimal amount has no "Fix:" hint, unlike the bad-date PARSE-005.

## Rerun
    npm install invoicelint
    node gen.mjs   # regenerates invoices/ and expected.json
    node run.mjs   # prints a pass/fail table

## Status in invoicelint 0.2.0
All four gaps and the minor point are fixed: CA-MATH-005 (g), CA-RATE-004 (h and 29, a warning to
confirm place of supply), CA-TOTAL-001 (b: no tier, tier rules skipped) and a Fix hint on PARSE-005 (c).
`29-ns-15-in-2026` now expects CA-RATE-004 in `expected.json`; the other 29 results are unchanged.
The `edge/` expectations are in `expected-edge.json`, and `test/real-world.test.ts` checks all 38 files.
Details: `docs/decisions.md`, section "0.2.0".
