# Roadmap

## Bigger pieces

- **Browser playground** (GitHub Pages): drop a JSON or XML invoice and see the findings inline. The core already runs in the browser (`pnpm check:dist` proves it), and `decodeInvoiceBytes()` and `toJsonOutput()` are exported for exactly this.
- **Credit note pack**: the _Credit Note and Debit Note Information (GST/HST) Regulations_ (SOR/91-44). UBL credit notes are already recognized (PARSE-UBL-010).
- **QST pack**: Revenu Québec's parallel input tax refund requirements.
- **US pack** (DBNAlliance) and **EU pack** (EN 16931).
- **GitHub Action** that runs `invoicelint check` on invoices in a repository.

## Good first issues

Each of these is small and self-contained. Comment on the issue (or open one) before starting.

- **Add QST number validation.** Quebec QST registration numbers have their own format (10 digits + `TQ` + 4 digits). Start with a format check like `src/packs/ca-gst-hst/bn.ts`, sourced from Revenu Québec, before any full QST pack.
- **Credit note pack skeleton.** Map UBL `CreditNote` onto the model (a document type field) and add the first rule from SOR/91-44 with its citation.
- **Combined GST + PST totals.** Model s.3(b)(iii)(B) (one GST+PST total with a statement that it includes GST) so those invoices stop getting a false CA-ITC-011 warning. See "Q2" in `docs/decisions.md`.
- **Unwrap Peppol envelopes.** Accept a `StandardBusinessDocument` and validate the `Invoice` inside it.
- **Extend the rate table back to 2013-04-01.** The CRA table covers it, but its New Brunswick row for July–September 2016 looks wrong (see `docs/decisions.md`); confirm against another CRA source first.
- **`--format sarif`** output, so GitHub code scanning can show findings.
- **Map `cbc:TaxPointDate`** from UBL to `taxPaidDate`.
- **Smaller browser bundle.** It is about 550 KB minified, mostly zod. Try `zod/mini` for the model.
