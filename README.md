# invoicelint

> **Status: early development (v0.0.0).** Nothing is published yet. The sections below are placeholders that later phases fill in.

`invoicelint` checks whether an invoice has everything a buyer needs to claim tax credits, and whether its tax math adds up. Every finding comes with a rule ID, a severity, the field involved, a plain-English fix and a citation to the law.

It starts with Canada (GST/HST input tax credits). Rules ship in pluggable **rule packs**, so packs for other countries can be added later.

## What are input tax credits?

_TODO (phase 5): a two-sentence explanation._

## Install

_TODO (phase 5)._

## Usage

```sh
invoicelint check invoice.json --format pretty
```

_TODO (phase 5): library API, examples and sample output._

## Invoice model

Every input format is mapped onto one canonical invoice shape. It's defined with [zod](https://zod.dev) in [`src/model.ts`](./src/model.ts) and published as a JSON Schema at [`schema/invoice.schema.json`](./schema/invoice.schema.json) for non-TypeScript users. The npm package ships it too, as `invoicelint/schema.json`.

```json
{
  "invoiceNumber": "INV-1042",
  "issueDate": "2026-03-15",
  "supplier": { "name": "Maple Supply Co.", "gstHstNumber": "123456782RT0001", "province": "ON" },
  "buyer": { "name": "Northwind Ltd." },
  "lines": [
    { "description": "Printer paper, 10 cases", "lineTotal": "221.24", "taxStatus": "taxable" }
  ],
  "taxes": [{ "type": "HST", "rate": 13, "taxableAmount": "221.24", "amount": "28.76" }],
  "subtotal": "221.24",
  "total": "250.00",
  "paymentTerms": "Net 30"
}
```

- **Money** is a number or a decimal string (`1234.56`, `"1,234.56"`) with at most 2 decimal places. Internally it becomes integer cents; tax math never uses floats.
- **Rates** are in percent: `13` means 13%.
- **Dates** are `YYYY-MM-DD`.
- **`lines[].taxStatus`** records what the document _states_ (`taxable`, `zero-rated`, `exempt`). Leave it out when the document doesn't say: the rules need to tell "not stated" apart from "taxable".
- Only `total` is required. Fields that the tax rules check (supplier name, registration number, buyer, terms, ...) are optional in the schema, so a missing one is reported as a finding with a legal citation, not a parse error.

## Rules

The `ca-gst-hst` pack checks the information a buyer needs to claim GST/HST input tax credits (SOR/91-45 s.3), the registration number, the tax math and the GST/HST rate. **[See every rule with its citation](./docs/rules.md)**: that page is generated from the rule metadata.

- **warning**: information missing from this document (it may be on another document, so never "illegal")
- **error**: wrong data (malformed number, math that doesn't add up, a rate not in force)
- **info**: the tier detected, and any check that was skipped

## Development

Requires Node 22+ and pnpm (via [Corepack](https://nodejs.org/api/corepack.html): `corepack enable`).

```sh
pnpm install
pnpm check     # typecheck + lint + format check + tests
pnpm build
```

## Disclaimer

This is not tax or legal advice. _TODO (phase 5): full disclaimer._

## License

[MIT](./LICENSE)
