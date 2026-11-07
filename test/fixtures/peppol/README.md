# Official Peppol examples (not committed)

`pnpm test:peppol` downloads OpenPeppol's example invoices from
[OpenPEPPOL/peppol-bis-invoice-3](https://github.com/OpenPEPPOL/peppol-bis-invoice-3/tree/master/rules/examples)
into this folder and runs `test/peppol.test.ts` on them. The `.xml` files are gitignored.

## Why they are not in the repository

- The examples repository has **no license file** (checked 2026-11-07).
- The Peppol BIS Billing 3.0 specification's "Statement of copyright" says: "OpenPeppol AISBL holds the copyright of this Peppol BIS … This Peppol BIS document may not be modified, re-distribute, sold or repackaged in any other way without the prior consent of OpenPeppol AISBL."
- Some files in that repository (the CEN schematron) state the EUPL 1.2, but the example invoices state no license.

So invoicelint downloads them for local testing but does not redistribute them. The committed European fixtures in `test/fixtures/eu/` were written for this project instead.

© OpenPeppol AISBL for the example invoices.
