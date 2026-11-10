# Changelog

All notable changes to this project are documented here. The project uses [Semantic Versioning](https://semver.org/). From 0.3.0, [release-please](https://github.com/googleapis/release-please) writes each entry from the [Conventional Commits](https://www.conventionalcommits.org/) since the last release, with sections named as in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); unreleased changes are in the open release PR. 0.2.0 and earlier were written by hand.

## [0.2.0] - 2026-11-10

Fixes the four gaps found by running 0.1.0 on a set of 38 real-world-style test invoices, which are now part of the test suite, and two similar gaps found while fixing them: tax-included rates were never checked, and most input errors had no Fix hint. The `ca-gst-hst` pack is version 0.2.0, with 25 rules.

### Added

- **CA-MATH-005** (warning): GST/HST charged on more than the lines not marked exempt or zero-rated, for example HST on zero-rated groceries as well as the taxable items. Before, only an invoice whose lines were _all_ exempt or zero-rated was caught (CA-MATH-004).
- **CA-RATE-004** (warning): the supplier's province is known and the GST/HST rate charged isn't that province's rate on the tax date, for example an Ontario supplier charging 5% GST, or a Nova Scotia supplier still charging 15% in 2026. The message says to confirm place of supply. It's a warning, not an error, because the supply can be made in another province. It also checks the rate in a tax-included statement ("HST 15% included"), which no rule read before. A stated rate that is no GST or HST rate, such as BC's 12% GST + PST, gets an info instead.
- **CA-TOTAL-001** (info): a negative total looks like a refund or credit note, so the tier rules aren't applied.
- **A Fix hint on every input error.** Many had none. Now amounts with too many decimals or in a format that isn't accepted, rates out of range, unknown province codes, tax statuses and tax types, a lowercase currency, values of the wrong type, and malformed or too-deeply nested XML all say how to fix them.
- **Real-world test invoices** in `test/real-world/`: 30 invoices with their expected results, 8 edge cases (messy input, rejected input and the four gaps), and the report that found the gaps.

### Changed

- **A negative total gets no tier.** The report has no `tier`, and CA-TIER-001, CA-TIER-002, the CA-ITC rules and CA-BN-003 don't run. The math, rate and GST/HST number checks still do. CA-CUR-001 still warns about a foreign currency, without the tier wording. In 0.1.0 such a document was checked as a tier-1 invoice.
- **Engine:** a rule with `appliesFromTier` is now skipped when the pack's context has no tier (it used to run). `CaContext.tier` is optional. CA-TIER-001 and CA-TIER-002 declare `appliesFromTier: 1`, so `docs/rules.md` lists them as tier "1+".
- New rate-table lookups `rateIn()` and `jurisdictionsWith()` on the pack's `rates` helpers.

### Fixed

- An XML file containing only an XML declaration reported its error position as "line 1, column undefined".
- Too-deeply nested XML now says "nested more than 100 elements deep" instead of the parser's "Maximum nested tags exceeded".

## [0.1.0] - 2026-11-09

First release.

### Added

- **`ca-gst-hst` rule pack**: GST/HST input tax credit information (SOR/91-45 s.3) by tier ($100 / $500, total including tax), GST/HST registration numbers (format, Luhn check digit, `RT` program, bare BN warning), tax math (lines, subtotal, allowances/charges, taxes, total; tax vs rate within a 1-cent tolerance) and GST/HST rates from a dated table sourced from the CRA, with a 60-day transition window around rate changes. 22 rules, each with a citation and a fix hint.
- **Inputs**: a canonical JSON model (zod schema, published JSON Schema) and UBL 2.1 / Peppol BIS Billing 3.0 XML, with automatic format detection and file decoding (BOM, UTF-16, declared XML encodings).
- **XML security**: size limit, DTD/entity declarations refused (XXE, billion laughs), depth limit.
- **CLI** `invoicelint check` with pretty output (colours, `NO_COLOR`), JSON output (stable, versioned), `--strict`, `--quiet`, `--verbose`, `--pack`, `--format-in`, `--rate-window-days`, wildcard expansion on every OS, and exit codes 0 / 1 / 2. `invoicelint rules` lists the rules.
- **Per-file `status`** in the JSON output: `ok`, `failed`, `skipped` or `input-error` ([json-output.md](./docs/json-output.md#file-status)). A UBL credit note is recognized but not checked yet: it shows as `⊘ SKIPPED — credit note (not checked yet)`, is counted as skipped in the summary line, and exits 0, even with `--strict`.
- **Library** `validate()` that runs in Node and in the browser, with TSDoc on every export.
- Generated rule reference (`docs/rules.md`), design decisions (`docs/decisions.md`), input and output documentation.

[0.2.0]: https://github.com/larplarp67/invoicelint/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/larplarp67/invoicelint/releases/tag/v0.1.0
