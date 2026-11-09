# Decisions

This file records non-obvious decisions and open questions. Newest entries go at the top of each section.

## Open questions

_None at the moment. Answers to the earlier ones are recorded under "Maintainer answers (2026-11-07)"._

## Phase 5: CLI, packaging, release prep

### `engines`: Node `>=22.12`, not `>=20`

The phase spec asked for `node >=20`. commander 15, the CLI's runtime dependency, declares `node >=22.12.0`, and Node 20 reached end-of-life in April 2026; the maintainer had chosen Node 22+ in Phase 1. So `engines.node` is `>=22.12` (previously `>=22`, which understated commander's requirement).

### Exit codes and what counts as an input error

`0` ok · `1` issues · `2` usage or input error, with `2` winning over `1` across files. A file is an **input error** when it can't be read (INPUT-001), can't be decoded (INPUT-002), or its parsing failed so no rules ran (any PARSE error that stops parsing, including a JSON document without `total`). Errors reported alongside a parsed invoice (PARSE-UBL-030 currency mismatch, PARSE-UBL-031 for anything but the total) are ordinary errors (`1`), because the invoice was still checked. A credit note (PARSE-UBL-010, info) is "skipped", exit `0`, even with `--strict` (see [Skipped files](#skipped-files-credit-notes)).

### Output format follows the terminal

Pretty output when stdout is a TTY, JSON otherwise (`--format` overrides). Colours follow [no-color.org](https://no-color.org): a non-empty `NO_COLOR` turns them off, `FORCE_COLOR` (not `0`) turns them on, otherwise they follow the TTY. `process.stdout.isTTY` is `undefined`, not `false`, for a pipe; passed straight to picocolors' `createColors()` that means "use the default", which is on for Windows, so colour codes leaked into redirected output. It is coerced to a boolean.

### A stable JSON output shape

`--format json` prints one document: `schemaVersion` (1), `tool`, `summary`, and `files[]` with `status` (`ok` | `failed` | `skipped` | `input-error`). It is built by `toJsonOutput()` in `src/output.ts`, which is browser-safe and exported, so the playground and a GitHub Action can produce the same document. Documented in [json-output.md](./json-output.md); `schemaVersion` changes only on breaking changes. Infos are always included in JSON; `--verbose` only affects pretty output.

### Pretty output details

- Field paths become labels ("taxes[0].rate" → "Tax line 1 rate") via `fieldLabel()`; the raw path stays in JSON.
- Text wraps at the terminal width, capped at 100 columns; 100 when stdout isn't a terminal (`columns` is undefined there, which first produced one word per line).

### Skipped files (credit notes)

Release prep, 2026-11-09. A credit note used to show as "– not checked", and the maintainer asked that a document no rules ran on must never look like a pass. It now shows as `⊘ SKIPPED — credit note (not checked yet)` in a dim, neutral colour (never green), the summary line counts it separately ("3 files · 1 failed · 1 skipped · 4 warnings"), and it gives exit `0`, even with `--strict`: `--strict` makes warnings fail, and a skipped file has none to judge.

The header names the reason, so the PARSE-UBL-010 note is shown only with `--verbose`; a skipped file whose reason the header can't name (none today) still shows its notes. The JSON `status` values were renamed to match the words on screen: `pass` → `ok`, `fail` → `failed`, `not-checked` → `skipped`, and `summary.notChecked` → `summary.skipped`. `input-error` stays a separate status because it has its own exit code (`2`). 0.1.0 wasn't published yet, so `schemaVersion` stays `1`.

### Public API documentation is tested

`test/api-docs.test.ts` uses the TypeScript compiler API to list every export of `src/index.ts` and fails if one lacks its own TSDoc comment. A file-header comment doesn't count: TypeScript attaches it to the first declaration, which is how `Severity` looked documented without being so. The test also found that `validate()` had lost its comment to `detectFormat()` when that was inserted above it in Phase 4.

### Proving the package works in Node and the browser

`pnpm check:dist` (CI, after build) imports `invoicelint` by name in Node (package self-reference through `exports`), and bundles `dist/index.js` with esbuild for `platform: browser`, then runs `validate()` in a `vm` sandbox without `process`, `require` or `Buffer`. The package name is a variable in that script so `tsc` doesn't try to resolve it: `dist/` doesn't exist yet when CI typechecks.

### Demo GIF rendered in CI

VHS needs Go, ttyd and ffmpeg, none of which were installed on the maintainer's machine. Rather than install them, the "Demo GIF" workflow renders `docs/demo.tape` with `charmbracelet/vhs-action` and uploads the GIF, which is then committed. The tape stays the source of truth.

### Docs are tested too

`test/docs.test.ts` checks that the README's sample JSON is real CLI output, the examples in `docs/inputs.md` validate cleanly, the CHANGELOG's rule count matches the pack, and every relative link in the Markdown files points at a file that exists.

## Maintainer answers (2026-11-07)

### LICENSE copyright holder

The MIT LICENSE now reads "Copyright (c) 2026 Bosco <LASTNAME>" (was "invoicelint contributors"). `<LASTNAME>` is a placeholder the maintainer will fill in.

### Tax date and a transition window around rate changes

**Tax date** = the earlier of `issueDate` and `taxPaidDate` (when present). This follows ETA s.168(1): tax "is payable … on the earlier of the day the consideration for the supply is paid and the day the consideration for the supply becomes due" (checked on laws-lois.justice.gc.ca). The invoice date stands in for "becomes due". Rate checks (CA-RATE-001/002/003) and CA-TIER-002 use this date.

**Transition window.** For every rate change in `rates.ts` (consecutive periods of a province with different rates; today only Nova Scotia 15% → 14% on 2025-04-01), the old and the new rate are both accepted within `rateTransitionDays` (default **60**, configurable via `validate()` and `--rate-window-days`) of the change's effective date:

- Rate in force on the tax date in some province → no finding.
- Not in force, but it is the old or new rate of a change within the window → CA-RATE-002 as a **warning**: "…This invoice is near a rate change; confirm which rate applied." The report stays `ok`.
- Otherwise → CA-RATE-002 stays an **error**.

The same logic runs for GST (CA-RATE-001), though the table has no GST change. Window edges are inclusive: with 60 days, 2025-01-31 (60 days before) warns and 2025-01-30 (61 days) errors.

**This is a simplification of the transitional rules, not an implementation of them.** The real rules (e.g. for Nova Scotia 2025) decide the rate from when consideration was paid or became due, with special cases for continuous supplies, real property and so on. An invoice often doesn't show enough to apply them, so a fixed window that downgrades to a warning is a pragmatic stand-in.

Test cases from the maintainer: HST 14% on 2025-01-15 → error; on 2025-03-20 → warning. (The first suggestion, HST 15% on 2025-04-10 → warning, can't happen: 15% is still the rate in New Brunswick, Newfoundland and Labrador and PEI, so it passes. It is tested as "no finding".) Fixture `invalid/12` moved from 2025-03-15 (now inside the window) to 2025-01-15 so it stays the error case; `invalid/22` (2025-03-20) is the warning case. Fixtures can now assert `$expect.ok`.

### Credit notes: recognized, not checked

A UBL `CreditNote` gives PARSE-UBL-010 (info): "credit notes are recognized but not checked yet". No invoice rules run on it (no tier, no ITC rules), the report is `ok` with no packs, and the CLI prints NOT CHECKED. Credit notes have their own prescribed information under the **Credit Note and Debit Note Information (GST/HST) Regulations**, SOR/91-44. (The maintainer's note said "Credit Note Information (GST/HST) Regulations"; the regulation's actual title, checked on laws-lois.justice.gc.ca, includes "and Debit Note".) A credit note pack is on the README roadmap. A JSON document with a negative total is still checked as an invoice (it lands in tier 1): the JSON model has no credit-note type yet.

### Bare 9-digit BN: CA-BN-003 (warning)

A GST/HST registration number is the BN plus `RT` and a 4-digit reference (`123456789RT0001`). When a well-formed 9-digit BN is shown with nothing after it, CA-ITC-010 is satisfied (a number is shown) and **CA-BN-003** warns: "Only the 9-digit Business Number is shown…". Implementation choices:

- It applies **from tier 2**. Tier 1 (s.3(a)) needs no registration number, so a bare BN on a small receipt isn't missing information. Fixture `valid/bare-business-number-tier1` covers this.
- A malformed 9-digit number is CA-BN-001 only, not also CA-BN-003.
- Severity is warning (information missing from this document), consistent with the severity policy.

## Phase 4: UBL input

### XML security policy

- **Size limit** checked before parsing: default 5 MB of UTF-8 (`maxXmlBytes`), counted in bytes, not characters.
- **No DTDs at all.** Any `<!DOCTYPE` or `<!ENTITY` is refused (PARSE-UBL-003) before the parser runs. UBL never needs a DTD, and refusing them outright removes XXE and entity-expansion attacks no matter how the parser is configured. Tested: fast-xml-parser's validator accepts a billion-laughs document as well-formed, so the library's validator alone isn't a defence.
- **Entity decoding is ours.** The parser's entity processing is off. The five predefined entities and numeric character references (`&#233;`) are decoded in one pass, so `&amp;#233;` stays the literal text `&#233;`. With `htmlEntities: false`, fast-xml-parser 5.12 does not decode numeric references, so this is needed for correctness too. CDATA is never decoded.
- **Depth limit**: 100 nested elements by default.
- Values are kept as strings (`parseTagValue: false`); amounts go through `money.ts`, never `parseFloat`.

### Namespaces resolved by URI

The tree is built from fast-xml-parser's ordered output with our own namespace scoping: each element carries its namespace URI and local name, and lookups use `(URI, local name)`. Prefixes (`cbc:`, `cac:`, a default namespace, or anything else) don't matter. An undeclared prefix is a PARSE-UBL-002 error.

### Element paths checked against the Peppol BIS Billing 3.0 tree

Checked on 2026-11-07 against <https://docs.peppol.eu/poacc/billing/3.0/syntax/ubl-invoice/tree/>. Differences from the phase spec:

- **Seller name.** Peppol labels `PartyLegalEntity/RegistrationName` "Seller name" and `PartyName/Name` "Seller trading name". The spec's order (trading name, then legal name) is kept: s.3(a)(i) accepts either "the name of the supplier" or "the name under which the supplier does business".
- **Buyer name.** `PartyLegalEntity/RegistrationName` ("Buyer name") goes to `buyer.name`, and `PartyName/Name` ("Buyer trading name") to `buyer.tradingName`. CA-ITC-020 accepts either.
- **`CountrySubentityCode`** is not in the Peppol tree. It exists in generic UBL 2.1 and is read only when `CountrySubentity` is absent.
- **`PartyTaxScheme` (0..2):** one has `TaxScheme/ID = VAT` (BT-31), the other any other value (BT-32, tax registration identifier). For `gstHstNumber` the parser prefers a scheme naming GST/HST (or TPS/TVH), then a non-VAT scheme, then VAT.
- **`TaxTotal` (1..2):** the second one, when present, is in the tax currency and has no subtotals. The parser uses the `TaxTotal` whose `TaxAmount@currencyID` equals `DocumentCurrencyCode`, as the spec says.

### "Looks Canadian" gate (maintainer-approved)

The seller "looks Canadian" when `PostalAddress/Country/IdentificationCode` is `CA`, or there is no country and the currency is CAD. Only then is `PartyTaxScheme/CompanyID` mapped to `gstHstNumber`, a province derived, and VAT percentages turned into GST/HST. Otherwise the tax number is left out with a PARSE-UBL-022 info, so a Norwegian VAT number never produces a false CA-BN-001.

### GST/HST from UBL tax subtotals

UBL has no native GST/HST distinction; Peppol always uses `TaxScheme/ID = VAT`. Rules for each `TaxSubtotal`:

1. `TaxScheme/ID` of GST, HST, PST or QST is used as is (so an explicit "GST at 7%" still reaches CA-RATE-001).
2. Otherwise, for a Canadian seller: 5% → GST; 13%, 14% or 15% → HST.
3. Anything else → type `OTHER` with a PARSE-UBL-021 info. The amount still counts in the totals.
4. A subtotal that charges $0 in a category other than `S` (zero-rated, exempt, outside scope, reverse charge) is skipped: it adds nothing and has no GST/HST meaning.

The inference can be wrong: a Canadian invoice with a 13% PST-like charge labelled VAT would become HST. Real Canadian e-invoices should state the scheme explicitly.

### Totals: `TaxInclusiveAmount`, not `PayableAmount`

`total` = `LegalMonetaryTotal/TaxInclusiveAmount` (total including tax). `PayableAmount` is reduced by `PrepaidAmount` and adjusted by `PayableRoundingAmount`, so it is the amount still due, not the "total amount paid or payable" s.3 uses for the tier. `subtotal` = `LineExtensionAmount` (sum of lines), with `AllowanceTotalAmount` / `ChargeTotalAmount` mapped to the new `allowanceTotal` / `chargeTotal`. Run against the 10 official Peppol examples (fetched locally, not committed): no crashes and no false CA-MATH errors, including the ones with allowances and charges.

### Payment terms from `DueDate`

`PaymentTerms/Note` → `paymentTerms`. When there is none but `cbc:DueDate` exists, `paymentTerms` becomes `"Due <date>"`. Whether a due date alone counts as "the terms of payment" (s.3(c)(iii)) is an interpretation; it's treated as enough here because it tells the buyer when payment is owed.

### Lines

- `description` = `Item/Name`, plus `—` and `Item/Description` when that differs.
- `taxStatus` from `ClassifiedTaxCategory/ID`: S → taxable, Z → zero-rated, E → exempt. Any other UNCL5305 code (AE, K, G, O, L, M, B) leaves it unset with a PARSE-UBL-020 info. No category element at all leaves it unset silently ("not stated").
- `unitPrice` is left out (PARSE-UBL-022 info) when `PriceAmount` has fractions of a cent (Peppol allows that) or `BaseQuantity` isn't 1. No rule uses the unit price, so dropping it is safer than failing the whole invoice. The same goes for a quantity with more than 6 decimals.

### Required elements and errors

PARSE-UBL-031 covers `cbc:ID`, `cbc:IssueDate`, `cbc:DocumentCurrencyCode` (added: without it every amount would silently be treated as CAD) and `TaxInclusiveAmount`. Only a missing `TaxInclusiveAmount` stops parsing, since there is no total to tier. For the others the invoice is still checked and the error is reported alongside the rule findings. PARSE-UBL-030 (an amount in another currency) is also reported without stopping the parse.

### Not mapped (yet)

- No intermediary: UBL has no direct equivalent of an s.3 intermediary.
- `cbc:TaxPointDate` isn't mapped to `taxPaidDate`: an invoice always has `IssueDate`, which the rules use first.
- A Peppol transport envelope (`StandardBusinessDocument`) isn't unwrapped; pass the `Invoice` itself.

### Format auto-detection

`validate()` and the CLI treat a string that starts with `<` (after optional BOM and whitespace) as UBL XML and anything else as JSON. Objects are JSON. `format: 'json' | 'ubl'` (CLI `--format-in`) overrides it. Forcing UBL on a non-string is a programmer error (TypeError).

### Parse notes in the report

Both parsers now return `{ ok: true, invoice, issues }`; the UBL parser's `issues` (infos such as PARSE-UBL-020/021/022 and non-blocking errors such as PARSE-UBL-030/031) are put at the front of the report, in the right severity bucket, and `ok` is recomputed. A credit note (PARSE-UBL-010, info) gives a report that is `ok` with no packs run: nothing was checked, but nothing is wrong either. The CLI prints "(no rule packs ran)" so it isn't mistaken for a pass.

### A working `check` command now; polish in Phase 5

Phase 4's done-criteria need `invoicelint check` on both formats, so a plain version ships now: per-file PASS/FAIL, tier, each finding with its fix and source, `--format json`, `--format-in`, `--pack`. Exit codes: 0 no errors, 1 errors in any file, 2 usage error (bad option, unknown pack, unreadable file). Colours, friendlier field labels, a summary and `--strict` are Phase 5.

`--pack` takes one ID per flag (repeatable or comma-separated). The planned variadic `--pack <id...>` would swallow the file names after it (`check --pack ca-gst-hst invoice.json` would treat the file as a second pack).

### Reading files: encodings and wildcards (found while verifying on Windows)

- **Encodings.** The CLI reads raw bytes and decodes them with `decodeInvoiceBytes()` (browser-safe, exported for the playground). A BOM wins (UTF-8, UTF-16LE, UTF-16BE). UTF-16 without a BOM is recognised from the zero byte next to the first `<` or `{`. Otherwise an XML declaration's `encoding` is honoured (e.g. ISO-8859-1, which TextDecoder treats as windows-1252), and everything else is UTF-8. Before this, a UTF-16 file written by Windows PowerShell 5.1 (`Out-File`, `>`) failed as "not valid JSON", and Latin-1 XML lost its accented letters. An encoding TextDecoder doesn't know is a usage error (exit 2).
- **Wildcards.** cmd.exe and PowerShell pass `*.xml` to programs unexpanded, so the CLI expands wildcard arguments itself with `fs.glob`, converting `\` to `/` on Windows (fs.glob ignores backslash paths). An argument that exists as written is never expanded, so a file literally named `invoice[1].json` still works. A pattern matching nothing is a usage error.

### `XMLValidator` is deprecated in fast-xml-parser 5.x

fast-xml-parser 5.12 marks `XMLValidator` as deprecated in favour of the separate `fast-xml-validator` package (same author, first published May 2026, with its own dependency chain). The built-in validator still ships and works, so it is kept with a targeted lint exception. Revisit when upgrading to fast-xml-parser 6.

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
- **error**: wrong data: malformed registration number, math that doesn't add up, a rate not in force. (Later exception: within the transition window of a rate change, CA-RATE-002 is a warning; see "Tax date and a transition window".)
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

### Rate checks use the tax date, against any province

_Superseded in part by "Tax date and a transition window" above._ The date for rate checks was `issueDate`, else `taxPaidDate`; it is now the earlier of the two. Transition rules (e.g. Nova Scotia 2025) tie the rate to when consideration is paid or becomes due, which usually matches the invoice date; an invoice for consideration that became due before a change could legitimately show the old rate. Place of supply isn't determined yet, so an HST rate passes if **any** province had it on that date (`2025-03-15`: 13% or 15%; `2025-04-15`: 13%, 14% or 15%). PST and QST rates aren't checked.

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

Per the Phase 2 spec, a 9-digit BN alone passes the format check, and any program other than `RT` is `wrong-program`. Whether an invoice showing only the BN (no `RT0001`) satisfies s. 3(b)(i) is still open: Phase 3 added no rule for it (see "Open questions").

### 2026-11-07: Split on the program letters, not fixed positions

If characters 10–11 are letters, the number is split there. Otherwise it is split at the first two letters after a run of digits. A BN with a missing digit (`75761092RT0001`) therefore reports `length`, instead of a cascade of program and reference errors from shifted characters.

## Interpretation notes (s. 3 → model)

_Phase 2 notes; the Phase 3 decisions above take precedence._

- **Tier basis.** The total including tax, confirmed by the maintainer (Q4). The regulation alone doesn't settle it.
- **Supplier or intermediary.** (a)(i) and (b)(i) accept either the supplier's or an intermediary's name and BN. The model has an optional `intermediary` party; CA-ITC-001 and CA-ITC-010 accept either party (see the CA-ITC-010 decision).
- **Date.** (a)(ii) uses the invoice date. (a)(iii) uses the date tax was paid or payable when no invoice is issued. The model has `issueDate` and an optional `taxPaidDate`; date-based rules use `issueDate`, else `taxPaidDate`.
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
