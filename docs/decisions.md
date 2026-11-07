# Decisions

This file records non-obvious decisions and open questions. Newest entries go at the top of each section.

## Open questions

### Bare 9-digit BN on a tier-2+ invoice

A GST/HST registration number is the 15-character RT account (`123456789RT0001`). `bn.ts` accepts a bare 9-digit BN as well-formed (Phase 2 spec), so an invoice showing only the BN passes CA-ITC-010 and CA-BN-001. Should a bare BN get its own finding (for example an info: "shows the business number but not the RT account")?

### Credit notes

Negative totals (credit notes) are tiered like invoices, so a credit note always lands in tier 1. Credit notes have their own prescribed contents (ETA s.232) and are out of scope for v0.1.

## Phase 3 rule decisions (maintainer-approved 2026-11-07)

### Q1 resolved: invoices dated before 2021-04-20

The `$100` / `$500` thresholds were enacted by [S.C. 2024, c. 15](https://laws-lois.justice.gc.ca/eng/AnnualStatutes/2024_15/FullText.html), s. 142(1)–(3). Section 142(4) deems them in force from **2021-04-20**; before that they were `$30` / `$150` ([s. 3 as of 2014-10-31 to 2024-06-19](https://laws-lois.justice.gc.ca/eng/regulations/SOR-91-45/section-3-20141031.html)). Section 141 replaced the definition of "intermediary" from the same date.

ETA s.169(4) tests the documents "before filing the return in which the credit is claimed", so the thresholds in force **when the claim is filed** apply, not those on the invoice date. Decision: always use `$100` / `$500`, and emit **CA-TIER-002** (info) for invoices dated before 2021-04-20, explaining that a claim filed before that date used `$30` / `$150`.

### Q2 resolved: combined GST + PST total is a known gap

s.3(b)(iii)(B) allows one combined GST+PST total with a statement that it includes GST. The model can't represent it, so such an invoice gets a **false CA-ITC-011 warning**. Decision: document it as a known gap for v0.1. It is rare on e-invoices (UBL keeps taxes separate); revisit with CSV/PDF input.

### Q3 resolved: CA-ITC-013 triggers only when a line is marked exempt or zero-rated

s.3(b)(v) applies "where the status of two or more supplies is different" and asks for "an indication of the status of each taxable supply that is not a zero-rated supply". `lines[].taxStatus` records what the document **states**, so an unmarked line's real status is unknown.

- If any line is marked exempt or zero-rated, statuses can differ, and an unmarked line may be a taxable supply that needed marking. CA-ITC-013 warns on each unmarked line.
- If no line is marked exempt or zero-rated (all unmarked, or marked taxable plus unmarked), nothing shows that statuses differ. If they're all taxable nothing is required; if an unmarked one is exempt, only the taxable ones need marking and they already are. No warning.
- Exempt and zero-rated lines never need marking.

The phase spec's "(or some are unstated)" trigger would have warned on every multi-line invoice with unmarked lines. The maintainer chose the regulation reading.

Open interpretive point: many invoices mark exempt items ("E") and leave taxable items unmarked. Whether that counts as "an indication of the status of each taxable supply" by elimination isn't settled by the text; the rule treats unmarked as not indicated.

### Q4 resolved: tier includes tax

The maintainer confirmed the tier is based on the total **including** tax (the regulation alone doesn't settle it; see the Phase 2 analysis under "Interpretation notes"). No `tierBasis` option.

### CA-ITC-010: either named party's own number

s.3(b)(i) asks for the name of "the supplier or the intermediary" and the registration number of "the supplier or the intermediary, as the case may be". The phase spec required the intermediary's number whenever an intermediary is present. That would flag a compliant invoice showing the supplier's name and number alongside an unnumbered intermediary. Decision (maintainer): pass when any **named** party shows its own number. If no party is named, any number shown passes (CA-ITC-001 already reports the missing name).

### CA-ITC-011 and CA-ITC-012 skip when no supply can carry GST/HST

If every line is marked exempt or zero-rated, no input tax credit is possible, so the tax-disclosure rules don't apply. PST alone doesn't count as GST/HST disclosure.

### CA-ITC-022 also warns when a tier-3 invoice lists no supplies

s.3(c)(iv) needs "a description of each supply". An invoice with no lines describes none, so it gets the warning on `lines`. The generic-word list (info) is a heuristic.

### Severity policy

- **warning**: ITC information missing from this document. Supporting documentation can be spread across documents (s.2), so it is never "illegal".
- **error**: wrong data: malformed registration number, math that doesn't add up, a rate not in force.
- **info**: context and skipped checks.

`report.ok` = no errors. A `--strict` CLI flag (Phase 5) will also fail on warnings. Kept from the spec: **CA-MATH-004** (tax on all-exempt/zero-rated lines) is a warning, because either the statuses or the tax could be the wrong part.

### Citations for rules outside SOR/91-45

Math and rate rules cite the Excise Tax Act: s.165(1) (GST at 5% on the value of the consideration), s.165(2) (HST at the participating-province rate), s.165(3) (zero-rated supplies at 0%), s.159 (foreign currency converted to Canadian dollars). CA-MATH-001 and CA-MATH-002 are plain arithmetic and say so ("no statutory provision"). Verified on laws-lois.justice.gc.ca on 2026-11-07.

### Tax math rounding and tolerance

- **CA-MATH-003** recomputes each tax line as `rate × taxableAmount` with exact BigInt math, rounding an exact half-cent **away from zero**, and accepts a difference up to `toleranceCents` (default **1 cent**) per tax line. One cent absorbs both half-up vs banker's rounding and per-line vs per-invoice rounding on typical invoices. No primary source mandating a rounding method was found, so the check is tolerant rather than exact.
- **CA-MATH-002** allows `toleranceCents × number of tax lines`. With no tax lines the check is exact. When there is no subtotal it uses the sum of the lines.
- **CA-MATH-001** is exact: adding displayed amounts involves no rounding.
- Each check that lacks its inputs emits an info explaining what it skipped.

### Rate table source, coverage and a CRA table discrepancy

`rates.ts` is transcribed from the CRA page "GST/HST calculator (and rates)", table "GST/HST rates since April 1, 2013" (retrieved 2026-11-07, page modified 2025-04-01). Only the periods that cover invoices from **2017-01-01** onward are transcribed: 2016-10-01 to 2025-03-31, and 2025-04-01 onward.

The table's **New Brunswick** row shows 13% for July–September 2016, but CRA's [Excise and GST/HST News No. 99](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/news99/news99-excise-gst-hst-news-no-99.html) says "Effective July 1, 2016, the HST rate in New Brunswick would be 15%". That period is outside coverage, so it was left out rather than copied with a likely error. The CRA table could be used back to 2013-04-01 once that row is corrected.

### Rate checks use the invoice date, against any province

The date for rate checks is `issueDate`, else `taxPaidDate`. Transition rules (e.g. Nova Scotia 2025) tie the rate to when consideration is paid or becomes due, which usually matches the invoice date; an invoice for consideration that became due before a change could legitimately show the old rate. Place of supply isn't determined yet, so an HST rate passes if **any** province had it on that date (`2025-03-15`: 13% or 15%; `2025-04-15`: 13%, 14% or 15%). PST and QST rates aren't checked.

### Pack selection

`ca-gst-hst` is the only pack, so `appliesTo()` returns true for every invoice (a USD invoice still runs it and gets CA-CUR-001). When other packs arrive it should look at currency, supplier province and registration number.

## Model

### 2026-11-07: Fields that rules check are optional in the schema

The Phase 2 spec had `supplier.name`, `issueDate` and `invoiceNumber` as required. That would turn a missing supplier name or date into a parse error, and the tier-1 ITC rules could never report it with its citation. The maintainer chose to make them optional. Only `total` is required. `supplier` defaults to `{}`, and `lines` and `taxes` default to `[]`.

### 2026-11-07: Money as integer cents (`number`, not `bigint`)

Amounts are stored as `number` cents, checked with `Number.isSafeInteger` (up to about $90 trillion). `bigint` would make the parsed invoice impossible to `JSON.stringify` and can't be expressed in JSON Schema. Math that multiplies (rates, quantities) converts to `BigInt` internally, so nothing is ever computed with fractional floats.

### 2026-11-07: Sub-cent amounts are rejected, not rounded

`"12.345"` and float noise such as `0.1 + 0.2` are parse errors. Rounding silently would hide producer bugs and could flip a tier. Trailing zeros (`"12.340"`) are fine. Known limitation: real invoices sometimes show sub-cent **unit prices** (fuel, utilities). If that matters, a later change can give `unitPrice` a finer unit.

### 2026-11-07: Accepted money formats

The accepted forms are an optional `-`, an optional `$`, digits with optional comma grouping in groups of three, and `.` as the decimal point. French-Canadian formatting (`1 234,56`) is **not** accepted in the canonical JSON because a comma is ambiguous between grouping and decimal. Parsers for human-facing formats (CSV, PDF) should normalize before mapping.

### 2026-11-07: Rates and quantities as normalized decimal strings

`rate: 13` becomes `"13"`, and `quantity: "2.50"` becomes `"2.5"`. Strings keep values like 9.975 exact. Rates are in **percent** (0–100, up to 4 decimals). A producer sending fractions (`0.13`) would get a 0.13% rate, which the Phase 3 rate check will flag.

### 2026-11-07: Rounding default

Tax math rounds exact half-cents **away from zero** by default, with banker's rounding (`half-even`) available. I have not yet found a primary source for a CRA-mandated rounding method, so Phase 3 will check tax amounts within a configurable tolerance rather than demand an exact match.

### 2026-11-07: Unknown properties are stripped

Extra properties are ignored rather than rejected, so producers can include their own fields. A misspelled required field still fails as missing.

### 2026-11-07: JSON Schema via zod 4, not `zod-to-json-schema`

The spec named `zod-to-json-schema`. That package was deprecated in November 2025 and only converts zod 3-style schemas. Its README directs users to zod 4's native `z.toJSONSchema()`, which is what we use (`io: 'input'`, so the schema describes what callers send). A test fails if `schema/invoice.schema.json` is out of date. Regenerate it with `pnpm schema`.

### 2026-11-07: `.ts` import specifiers

Source files import each other with `.ts` extensions (`allowImportingTsExtensions`, `erasableSyntaxOnly`). Node 22.18+ can then run `scripts/generate-schema.ts` directly with no extra loader. tsup bundles the published output, so consumers never see `.ts` specifiers.

## Registration numbers

### 2026-11-07: Luhn check digit, matching python-stdnum

The CRA does not publish a check-digit algorithm for the BN. I found no CRA page describing one. The 9th digit behaves as a Luhn (mod 10) check digit, and `validateRegistrationNumber` matches python-stdnum's [`stdnum.ca.bn`](https://github.com/arthurdejong/python-stdnum/blob/master/stdnum/ca/bn.py), which runs `luhn.validate` on the first 9 digits. Passing means the number is well-formed, not that it is registered; only the CRA GST/HST Registry can confirm that, and it has no public API. Known Luhn blind spot: swapping adjacent `0` and `9` is not detected (covered by a test).

### 2026-11-07: Bare 9-digit BN is structurally valid

Per the Phase 2 spec, a 9-digit BN alone passes the format check, and any program other than `RT` is `wrong-program`. Whether an invoice showing only the BN (no `RT0001`) satisfies s. 3(b)(i) is left to a Phase 3 rule.

### 2026-11-07: Split on the program letters, not fixed positions

If characters 10–11 are letters, the number is split there. Otherwise it is split at the first two letters after a run of digits. A BN with a missing digit (`75761092RT0001`) therefore reports `length`, instead of a cascade of program and reference errors from shifted characters.

## Interpretation notes (s. 3 → model)

_Phase 2 notes; the Phase 3 decisions above take precedence._

- **Tier basis.** See Q4. The tool defaults to the total including tax. This is an interpretation, not a verified CRA position.
- **Supplier or intermediary.** (a)(i) and (b)(i) accept either the supplier's or an intermediary's name and BN. The model will carry an optional `intermediary` party, and the rules pass if either one has the information.
- **Date.** (a)(ii) uses the invoice date. (a)(iii) uses the date tax was paid or payable when no invoice is issued. The model will have `issueDate` plus an optional `taxPointDate`.
- **Recipient.** (c)(ii) also accepts the name of the recipient's authorized agent or representative.
- **"Not one document".** Supporting documentation may be spread across several documents (s. 2, definition of "supporting documentation"). Missing ITC fields are therefore reported as warnings ("this document alone does not contain X"), never as errors.

## Toolchain

### 2026-11-06: GitHub Actions versions

CI uses `actions/checkout@v7`, `actions/setup-node@v7` and `pnpm/action-setup@v6`, the latest releases as of 2026-11-06. `pnpm/action-setup` reads the pnpm version from `packageManager` in `package.json`.

### 2026-11-06: Node 22+ (not 20)

Node 20 reached end-of-life in April 2026. The current majors of tsup (9), vitest (5) and commander (15) require Node ≥ 22. The maintainer chose Node ≥ 22, with CI on Node 22 and 24. `engines.node` is `>=22`.

### 2026-11-06: TypeScript 6.0, not 7.0

TypeScript 7.0 (the native Go port) is `latest` on npm. typescript-eslint 8.x supports `typescript >=4.8.4 <6.1.0`, so it can't type-check-lint against TS 7 yet. TypeScript is pinned to `~6.0.3`. Revisit when typescript-eslint supports TS 7.

### 2026-11-06: zod 4 native JSON Schema

zod 4 ships `z.toJSONSchema()`, so `zod-to-json-schema` isn't needed for the exported JSON Schema.

### 2026-11-06: Browser-safe core enforced by lint

ESLint forbids `node:*` imports and the `process` and `Buffer` globals in `src/**` except `src/cli.ts`. tsup builds `index` with `platform: 'neutral'`.

### 2026-11-06: CLI exit codes vs commander defaults

Commander exits with code 1 on usage errors by default, but 1 means "issues found" here. The CLI uses `exitOverride()` and maps usage errors to 2.

### 2026-11-06: pnpm build-script approval

pnpm ≥ 10 blocks dependency install scripts by default. `esbuild` (used by tsup) is allowed in `pnpm-workspace.yaml` (`allowBuilds`).

## Naming

### 2026-11-06: package name

`invoicelint` is unclaimed on npm (checked 2026-11-06). So are `invoice-lint`, `itclint`, `itc-lint`, `gsthst-lint` and `gst-invoice-check`. `invoicelint` is kept because it is country-neutral, which fits the plan for US and EU packs. Alternative if wanted: `itclint` (shorter, but Canada-specific).
