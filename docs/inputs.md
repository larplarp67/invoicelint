# Inputs

invoicelint reads two formats and maps both onto one canonical invoice model. The format is detected automatically: input that starts with `<` (after whitespace or a byte-order mark) is XML, anything else is JSON. Override it with `--format-in json|ubl` on the CLI, or `validate(input, { format })` in code.

Files are decoded before parsing: a byte-order mark wins (UTF-8, UTF-16LE, UTF-16BE), UTF-16 without a BOM is recognised, and an XML declaration's `encoding` (for example ISO-8859-1) is honoured. Everything else is read as UTF-8.

## Canonical JSON

The model is defined with [zod](https://zod.dev) in [`src/model.ts`](../src/model.ts) and published as a JSON Schema at [`schema/invoice.schema.json`](../schema/invoice.schema.json). The npm package ships the schema too, as `invoicelint/schema.json`.

```json
{
  "invoiceNumber": "INV-1042",
  "issueDate": "2026-03-15",
  "supplier": { "name": "Maple Supply Co.", "gstHstNumber": "812345676RT0001", "province": "ON" },
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
- **Dates** are `YYYY-MM-DD`. `taxPaidDate` is the date tax was paid; rate checks use the earlier of it and `issueDate`.
- **Document-level discounts and charges** go in `allowanceTotal` and `chargeTotal` (positive amounts); `subtotal` is the sum of the lines before them.
- **Tax `type`** is `GST`, `HST`, `PST`, `QST`, or `OTHER` for a tax invoicelint doesn't classify (e.g. foreign VAT): it counts in the totals but not in the GST/HST checks.
- **`lines[].taxStatus`** records what the document _states_ (`taxable`, `zero-rated`, `exempt`). Leave it out when the document doesn't say: the rules need to tell "not stated" apart from "taxable".
- **`intermediary`** (`name`, `gstHstNumber`) is an intermediary such as a marketplace acting for the supplier; s.3 of the regulations accepts its details instead of the supplier's.
- Only `total` is required. Fields the tax rules check (supplier name, registration number, buyer, terms, ...) are optional in the schema, so a missing one is reported as a finding with a legal citation, not a parse error.
- Unknown properties are ignored.

## UBL 2.1 XML (Peppol BIS Billing 3.0)

UBL invoices are mapped onto the same model. Elements are matched by namespace URI, so `cbc:`/`cac:` prefixes, default namespaces or any other prefixes all work. A UBL invoice from an Ontario supplier, trimmed to the parts invoicelint reads:

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

How UBL maps to Canadian tax (full detail in [decisions.md](./decisions.md#phase-4-ubl-input)):

- Peppol labels every tax "VAT". For a Canadian seller, a 5% subtotal is read as **GST** and 13%, 14% or 15% as **HST**. An explicit `TaxScheme/ID` of `GST`, `HST`, `PST` or `QST` is used as is. Anything else counts as "other tax" with a note (PARSE-UBL-021).
- The seller's tax number becomes `gstHstNumber` only for a Canadian seller, so a European VAT number never triggers a GST/HST number error.
- Line tax category `S`/`Z`/`E` becomes taxable / zero-rated / exempt. Other codes (e.g. `AE` reverse charge) leave the status unset with a note (PARSE-UBL-020).
- The total is `TaxInclusiveAmount`, not `PayableAmount` (which prepayments reduce). `AllowanceTotalAmount` and `ChargeTotalAmount` map to `allowanceTotal` and `chargeTotal`.
- Credit notes are recognized (PARSE-UBL-010) but not checked yet.
- Security: XML over 5 MB, any DTD or entity declaration (XXE, "billion laughs") and deeply nested documents are refused before parsing.
