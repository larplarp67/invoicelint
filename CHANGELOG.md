# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - unreleased

First release.

### Added

- **`ca-gst-hst` rule pack**: GST/HST input tax credit information (SOR/91-45 s.3) by tier ($100 / $500, total including tax), GST/HST registration numbers (format, Luhn check digit, `RT` program, bare BN warning), tax math (lines, subtotal, allowances/charges, taxes, total; tax vs rate within a 1-cent tolerance) and GST/HST rates from a dated table sourced from the CRA, with a 60-day transition window around rate changes. 22 rules, each with a citation and a fix hint.
- **Inputs**: a canonical JSON model (zod schema, published JSON Schema) and UBL 2.1 / Peppol BIS Billing 3.0 XML, with automatic format detection and file decoding (BOM, UTF-16, declared XML encodings).
- **XML security**: size limit, DTD/entity declarations refused (XXE, billion laughs), depth limit.
- **CLI** `invoicelint check` with pretty output (colours, `NO_COLOR`), JSON output (stable, versioned), `--strict`, `--quiet`, `--verbose`, `--pack`, `--format-in`, `--rate-window-days`, wildcard expansion on every OS, and exit codes 0 / 1 / 2. `invoicelint rules` lists the rules.
- **Per-file `status`** in the JSON output: `ok`, `failed`, `skipped` or `input-error` ([json-output.md](./docs/json-output.md#file-status)). A UBL credit note is recognized but not checked yet: it shows as `⊘ SKIPPED — credit note (not checked yet)`, is counted as skipped in the summary line, and exits 0, even with `--strict`.
- **Library** `validate()` that runs in Node and in the browser, with TSDoc on every export.
- Generated rule reference (`docs/rules.md`), design decisions (`docs/decisions.md`), input and output documentation.

[Unreleased]: https://github.com/larplarp67/invoicelint/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/larplarp67/invoicelint/releases/tag/v0.1.0
