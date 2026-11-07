# invoicelint

**Lint Canadian invoices for the details a buyer needs to claim GST/HST input tax credits, and check that the tax math adds up.**

[![CI](https://github.com/larplarp67/invoicelint/actions/workflows/ci.yml/badge.svg)](https://github.com/larplarp67/invoicelint/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/invoicelint)](https://www.npmjs.com/package/invoicelint)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

## Why

A GST/HST-registered business can recover the GST/HST it pays on business purchases by claiming input tax credits (ITCs). To claim them, it must hold documents showing the information the _Input Tax Credit Information (GST/HST) Regulations_ prescribe: the supplier's GST/HST number, the tax charged, the buyer's name and more, depending on the amount. If an audit finds that information missing, the CRA can deny the credit, so the business ends up paying that GST/HST out of its own pocket.

invoicelint reads an invoice (JSON or UBL/Peppol XML) and tells you, in plain English, what's missing or wrong, with the exact paragraph of the law and how to fix it.

## Demo

![invoicelint checking a passing UBL invoice and a JSON invoice with a mistyped GST/HST number](./docs/demo.gif)

The demo is generated from [`docs/demo.tape`](./docs/demo.tape) with [VHS](https://github.com/charmbracelet/vhs).

## Quick start

Requires Node.js 22.12 or newer.

```sh
npx invoicelint check invoice.json
```

```sh
npm install --global invoicelint

invoicelint check invoice.xml                       # UBL 2.1 / Peppol BIS Billing 3.0
invoicelint check "invoices/**/*.{json,xml}"        # wildcards work on every OS
invoicelint check invoices/*.json --format json > report.json
invoicelint check invoice.json --strict             # warnings fail too
invoicelint check invoice.json --verbose            # also show info (tier, skipped checks)
invoicelint rules                                   # list every rule
```

Exit codes: `0` ok · `1` issues found · `2` usage or input error. Output is pretty in a terminal and JSON when piped (override with `--format pretty|json`). Set `NO_COLOR=1` to turn colours off.

As a library (Node or the browser; the core has no file-system access):

```ts
import { validate } from 'invoicelint';

const report = validate(invoiceJsonOrUblXml); // a string or a parsed object
console.log(report.tier); // 1, 2 or 3
for (const issue of [...report.errors, ...report.warnings]) {
  console.log(`${issue.ruleId} ${issue.field}: ${issue.message} (${issue.citation})`);
}
if (!report.ok) process.exitCode = 1; // ok = no errors; warnings don't fail it
```

## What it checks

The information required depends on the invoice total **including tax**, in Canadian dollars ([SOR/91-45 s.3](https://laws-lois.justice.gc.ca/eng/regulations/SOR-91-45/FullText.html)):

| Total incl. tax | The documents need                                                                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| under $100      | supplier's name, date, total                                                                                                                                                                 |
| $100 to $499.99 | the above, plus the supplier's GST/HST registration number, the GST/HST charged (or a tax-included statement with the rate), and which items are taxable when the invoice mixes tax statuses |
| $500 or more    | the above, plus the buyer's name, the terms of payment, and a description of each item                                                                                                       |

On top of that it checks the GST/HST registration number (format, check digit, `RT` program), the arithmetic (lines, subtotal, taxes, total), each tax amount against its rate, and whether the GST/HST rate was in force on the tax date.

**[All rules, with severity, tier, citation and fix hint →](./docs/rules.md)**

- **error**: something on the invoice is wrong (a mistyped GST/HST number, amounts that don't add up, a rate that wasn't in force).
- **warning**: information missing from _this_ document. The law lets it come from other documents, so a warning never means the invoice is illegal.
- **info**: context, such as the tier, or a check that was skipped and why.

## Supported inputs

- **JSON** in invoicelint's canonical model: [JSON Schema](./schema/invoice.schema.json) (also shipped as `invoicelint/schema.json`).
- **UBL 2.1 XML** invoices (Peppol BIS Billing 3.0), mapped onto the same model. Namespaces are matched properly, so any prefixes work.

The format is detected automatically. Field reference, a UBL example and how UBL's "VAT" maps to GST/HST: [docs/inputs.md](./docs/inputs.md).

## Output

`--format json` prints one stable, versioned document ([shape and rule ID families](./docs/json-output.md)). For an invoice with a mistyped GST/HST number:

<!-- sample: invoicelint check --format json invoice.json   (invoice.json = test/fixtures/invalid/06-registration-number-typo.json; kept in sync by test/docs.test.ts) -->

```json
{
  "schemaVersion": 1,
  "tool": { "name": "invoicelint", "version": "0.1.0" },
  "summary": {
    "files": 1,
    "passed": 0,
    "failed": 1,
    "notChecked": 0,
    "inputErrors": 0,
    "errors": 1,
    "warnings": 0,
    "strict": false
  },
  "files": [
    {
      "file": "invoice.json",
      "status": "fail",
      "format": "json",
      "tier": 2,
      "packs": [{ "id": "ca-gst-hst", "version": "0.1.0" }],
      "errors": [
        {
          "ruleId": "CA-BN-001",
          "severity": "error",
          "field": "supplier.gstHstNumber",
          "message": "The supplier's GST/HST number \"812345677RT0001\" fails the check-digit test, which usually means a digit was mistyped. A GST/HST number is 9 digits, then RT and 4 digits (e.g. 123456789 RT 0001).",
          "fix": "Compare the number with the supplier's records or the CRA GST/HST Registry, and ask for a corrected invoice if it's wrong.",
          "citation": "SOR/91-45 s.3(b)(i)"
        }
      ],
      "warnings": [],
      "infos": [
        {
          "ruleId": "CA-TIER-001",
          "severity": "info",
          "field": "total",
          "message": "Tier 2: the total of $250.00 including tax is between $100 and $499.99. To support an input tax credit, the documents need the supplier's name, the date, the total, the supplier's GST/HST number and the GST/HST charged (SOR/91-45 s.3(b)).",
          "fix": "No action needed. This tells you which information requirements apply.",
          "citation": "SOR/91-45 s.3(a), (b), (c)"
        }
      ]
    }
  ]
}
```

## Design notes

- **Money is integer cents.** Amounts are parsed from decimal strings into cents and tax is recomputed with exact integer math, never floats. Sub-cent amounts are rejected rather than silently rounded.
- **A dated rate table.** GST/HST rates are transcribed from the CRA's published table with its URL and retrieval date, so Nova Scotia's 15% → 14% change on 2025-04-01 is checked against the invoice's tax date (the earlier of the invoice date and the payment date, per ETA s.168(1)).
- **A transition window.** Within 60 days of a rate change either rate is accepted with a warning, because the transitional rules depend on facts an invoice often doesn't show. It's a deliberate simplification.
- **Warnings vs errors.** Missing information is a warning (it may be on another document); wrong data is an error. Every rule cites its legal source.
- **Pluggable rule packs.** Canada's rules live in one pack behind a small interface, so other countries can be added without touching the engine.

The reasoning behind every non-obvious choice, with sources: [docs/decisions.md](./docs/decisions.md).

## Limitations

- **Not tax or legal advice.** invoicelint checks documents against its reading of the regulations; it can be wrong and doesn't replace an accountant.
- **No place-of-supply determination.** An HST rate is accepted if any province had it on the tax date.
- **No QST rules** (Quebec), and PST rates aren't checked; their amounts still count in the totals.
- **No registry lookups.** A GST/HST number can be well-formed but not registered; only the CRA's GST/HST Registry can confirm that, and it has no public API.
- **Credit notes are recognized but not checked yet.**
- Combined GST + PST totals (allowed by s.3(b)(iii)(B)) can't be represented yet and get a false "no GST/HST shown" warning.

## Roadmap

- Browser playground: drop a JSON or XML invoice, see the findings inline
- QST pack (Revenu Québec's parallel requirements)
- Credit note pack (Credit Note and Debit Note Information (GST/HST) Regulations, SOR/91-44)
- US pack (DBNAlliance)
- EU pack (EN 16931)
- GitHub Action

Good first issues: [docs/ROADMAP.md](./docs/ROADMAP.md).

## Contributing

Bug reports, rule requests (with a legal citation) and pull requests are welcome: see [CONTRIBUTING.md](./CONTRIBUTING.md). Changes are listed in [CHANGELOG.md](./CHANGELOG.md).

## License

[MIT](./LICENSE)
