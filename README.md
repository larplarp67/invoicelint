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
invoicelint check invoice.json                # canonical JSON
invoicelint check invoice.xml                 # UBL 2.1 / Peppol BIS Billing 3.0
invoicelint check *.json *.xml --format json  # machine-readable report
```

Exit codes: `0` no errors (warnings allowed), `1` errors found, `2` usage error.

_TODO (phase 5): library API, sample output, `--strict`._

## Supported inputs

The format is detected automatically: input that starts with `<` is XML, anything else is JSON. Override it with `--format-in json|ubl` (or `validate(input, { format })`).

| Input                                        | Notes                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Canonical JSON**                           | The [invoice model](#invoice-model) below.                                                                                |
| **UBL 2.1 Invoice** (Peppol BIS Billing 3.0) | Mapped onto the same model. Elements are matched by namespace, so `cbc:`/`cac:` prefixes or default namespaces both work. |
| UBL credit notes                             | Recognized and reported (PARSE-UBL-010), not checked yet.                                                                 |

A UBL invoice from an Ontario supplier, trimmed to the parts invoicelint reads:

```xml
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>INV-1042</cbc:ID>
  <cbc:IssueDate>2026-04-02</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>CAD</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyName><cbc:Name>Maple Leaf Printing Inc.</cbc:Name></cac:PartyName>
    <cac:PostalAddress>
      <cbc:CountrySubentity>Ontario</cbc:CountrySubentity>
      <cac:Country><cbc:IdentificationCode>CA</cbc:IdentificationCode></cac:Country>
    </cac:PostalAddress>
    <cac:PartyTaxScheme>
      <cbc:CompanyID>812345676RT0001</cbc:CompanyID>
      <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
    </cac:PartyTaxScheme>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="CAD">28.76</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="CAD">221.24</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="CAD">28.76</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID><cbc:Percent>13</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="CAD">221.24</cbc:LineExtensionAmount>
    <cbc:TaxInclusiveAmount currencyID="CAD">250.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="CAD">250.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:InvoicedQuantity unitCode="EA">1</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="CAD">221.24</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>Business cards and letterhead</cbc:Name>
      <cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>13</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="CAD">221.24</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
</Invoice>
```

How UBL maps to Canadian tax (details in [docs/decisions.md](./docs/decisions.md)):

- Peppol labels every tax "VAT". For a Canadian seller, a 5% subtotal is read as **GST** and 13%, 14% or 15% as **HST**. An explicit `TaxScheme/ID` of `GST`, `HST`, `PST` or `QST` is used as is. Anything else counts as "other tax" with a note.
- Line tax category `S`/`Z`/`E` becomes taxable / zero-rated / exempt. Other codes (e.g. `AE` reverse charge) leave the status unset with a note.
- The total is `TaxInclusiveAmount`, not `PayableAmount` (which prepayments reduce).
- Security: XML over 5 MB, any DTD/entity declaration (XXE, "billion laughs") and deep nesting are refused before parsing.

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
- **Document-level discounts and charges** go in `allowanceTotal` and `chargeTotal` (positive amounts); `subtotal` is the sum of the lines before them.
- **Tax `type`** is `GST`, `HST`, `PST`, `QST`, or `OTHER` for a tax invoicelint doesn't classify (e.g. foreign VAT): it counts in the totals but not in the GST/HST checks.
- **Dates** are `YYYY-MM-DD`.
- **`lines[].taxStatus`** records what the document _states_ (`taxable`, `zero-rated`, `exempt`). Leave it out when the document doesn't say: the rules need to tell "not stated" apart from "taxable".
- Only `total` is required. Fields that the tax rules check (supplier name, registration number, buyer, terms, ...) are optional in the schema, so a missing one is reported as a finding with a legal citation, not a parse error.

## Rules

The `ca-gst-hst` pack checks the information a buyer needs to claim GST/HST input tax credits (SOR/91-45 s.3), the registration number, the tax math and the GST/HST rate. **[See every rule with its citation](./docs/rules.md)**: that page is generated from the rule metadata.

- **warning**: information missing from this document (it may be on another document, so never "illegal")
- **error**: wrong data (malformed number, math that doesn't add up, a rate not in force; near a rate change that is a warning, since either rate may apply)
- **info**: the tier detected, and any check that was skipped

## Roadmap

- **Credit note pack** (Credit Note and Debit Note Information (GST/HST) Regulations, SOR/91-44). UBL credit notes are already recognized (PARSE-UBL-010) but not checked.
- **QST pack** (Revenu Québec's parallel requirements)
- **US pack** (DBNAlliance) and **EU pack** (EN 16931)
- **Browser playground**: drop a JSON or XML invoice, see the findings inline
- **GitHub Action**

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
