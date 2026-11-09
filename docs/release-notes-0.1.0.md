# invoicelint 0.1.0

First release. invoicelint checks whether a Canadian invoice contains the information a buyer needs to claim GST/HST input tax credits (_Input Tax Credit Information (GST/HST) Regulations_, SOR/91-45 s.3), and whether its tax math adds up. It reads a simple JSON model or UBL 2.1 / Peppol BIS Billing 3.0 XML, and runs as a CLI or as a library in Node and the browser.

```sh
npx invoicelint check invoice.xml
```

Requires Node.js 22.12 or later.

## What's in it

- **`ca-gst-hst` rule pack**: 22 rules, each with a citation and a fix hint written for a bookkeeper.
  - GST/HST input tax credit information by tier ($100 / $500, total including tax).
  - GST/HST registration numbers: format, check digit, `RT` program, and a warning for a bare business number.
  - Tax math: lines, subtotal, allowances and charges, taxes, total, and tax against rate within a 1-cent tolerance.
  - GST/HST rates from a dated table sourced from the CRA, with a 60-day transition window around rate changes (such as Nova Scotia's 15% → 14% on 2025-04-01).
- **Inputs**: a canonical JSON model with a published JSON Schema, and UBL 2.1 / Peppol BIS Billing 3.0 XML, with automatic format detection and file decoding (BOM, UTF-16, declared XML encodings).
- **XML security**: a size limit; DTD and entity declarations refused (XXE, billion laughs); a depth limit.
- **CLI** `invoicelint check`:
  - pretty output (colours, `NO_COLOR`), or stable, versioned JSON output with a per-file `status` of `ok`, `failed`, `skipped` or `input-error`
  - `--strict`, `--quiet`, `--verbose`, `--pack`, `--format-in`, `--rate-window-days`
  - wildcards on every OS
  - exit codes `0` / `1` / `2`
  - `invoicelint rules` to list every rule
- **Credit notes**: UBL credit notes are recognized but not checked yet. They show as `⊘ SKIPPED — credit note (not checked yet)` and exit 0, even with `--strict`.
- **Library**: `validate()` runs in Node and in the browser, with TSDoc on every export.

## Limitations

- **Not tax or legal advice.** invoicelint checks documents against its reading of the regulations. It can be wrong, and it doesn't replace an accountant.
- **No place-of-supply determination.** An HST rate is accepted if any province had it on the tax date.
- **No QST rules** (Quebec), and PST rates aren't checked; their amounts still count in the totals.
- **No registry lookups.** A well-formed GST/HST number may still not be registered. Only the CRA's GST/HST Registry can confirm that, and it has no public API.
- Combined GST + PST totals (allowed by s.3(b)(iii)(B)) can't be represented yet, so they get a false "no GST/HST shown" warning.

## Documentation

- [README](https://github.com/larplarp67/invoicelint/blob/v0.1.0/README.md)
- [Every rule, with its citation](https://github.com/larplarp67/invoicelint/blob/v0.1.0/docs/rules.md)
- [Input formats](https://github.com/larplarp67/invoicelint/blob/v0.1.0/docs/inputs.md) and [JSON output](https://github.com/larplarp67/invoicelint/blob/v0.1.0/docs/json-output.md)
- [Design decisions](https://github.com/larplarp67/invoicelint/blob/v0.1.0/docs/decisions.md)
- [Changelog](https://github.com/larplarp67/invoicelint/blob/v0.1.0/CHANGELOG.md)
