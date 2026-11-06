# Decisions

This file records non-obvious decisions and open questions. Newest entries go at the top of each section.

## Open questions (need a maintainer decision)

### Q1. Invoices dated before the threshold change

**Verified (primary source).** The `$100` / `$500` thresholds were enacted by the _Fall Economic Statement Implementation Act, 2023_, [S.C. 2024, c. 15](https://laws-lois.justice.gc.ca/eng/AnnualStatutes/2024_15/FullText.html), s. 142(1)–(3). Royal assent was 2024-06-20. Section 142(4): "Subsections (1) to (3) are deemed to have come into force on April 20, 2021." Before that the thresholds were `$30` / `$150` ([s. 3 as of 2014-10-31 to 2024-06-19](https://laws-lois.justice.gc.ca/eng/regulations/SOR-91-45/section-3-20141031.html)). Budget 2021 (2021-04-19) announced the change.

Section 141 of the same Act also replaced the s. 2 definition of **"intermediary"**, deemed in force on the same date (April 20, 2021).

Remaining ambiguity: the deeming provision doesn't say whether the new thresholds apply by **invoice date**, **tax-payable date** or **ITC claim date**.

**Proposal:** use the invoice date (or `taxPointDate` if present). For invoices dated before 2021-04-20, still apply today's tiers, but emit an `info` issue: "invoice predates 2021-04-20; the $30/$150 thresholds may apply instead."

### Q2. Combined GST + PST total (s. 3(b)(iii)(B))

The plan's tier-2 rule says "GST/HST shown separately OR a statement that the total includes tax at a stated rate". The regulation allows a **third** form: where PST applies to every taxable, non-zero-rated supply (and to no exempt or zero-rated supply), the invoice may show **GST + PST combined** with a statement that the total includes GST. This is common on invoices from BC, SK, MB and QC suppliers.

**Proposal:** model it with a `taxPresentation` field (`separate` | `combined-with-pst` | `tax-included`) and accept all three in the tier-2 rule. Each form gets its own citation.

### Q3. Tier 2 "status" requirement (s. 3(b)(v))

The regulation asks for "an indication of the status of each taxable supply that is not a zero-rated supply" whenever two or more supplies have different statuses. Strictly, the **taxable, non-zero-rated** lines need to be marked; exempt and zero-rated lines don't. The plan said "tax status where an invoice mixes taxable and exempt/zero-rated items", which is close.

**Proposal:** if line statuses differ, flag every taxable, non-zero-rated line that has no explicit status indicator. Don't flag exempt or zero-rated lines.

### Q4. Does the tier threshold include tax?

The plan says tiers are based on the total **including** tax. The regulation's tier wording is "the total amount paid or payable shown on the supporting documentation". It doesn't say whether tax is included. Within s. 3 the same phrase is used both ways: (b)(iii) covers the case where "the amount paid or payable … does not include the amount of tax", and (b)(iv) covers the case where it does. So the regulation alone doesn't settle the question.

I found no current CRA guidance that settles it. GST/HST Memorandum 8.4 (August 2012) still shows the old `$30` / `$150` thresholds and says nothing about tax in the tier amounts.

**Proposal:** keep tax-inclusive, as the plan says. It is also the conservative choice for a linter: tax-inclusive puts borderline invoices into the higher tier, so the tool asks for more information, not less. Record it in the tier rule's metadata as an interpretation, and expose `tierBasis: 'incl-tax' | 'excl-tax'` as an option.

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

## Interpretation notes (s. 3 → model)

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
