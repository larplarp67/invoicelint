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
