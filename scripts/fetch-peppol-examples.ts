/**
 * Downloads OpenPeppol's official Peppol BIS Billing 3.0 example invoices into
 * test/fixtures/peppol/ (gitignored) for the opt-in robustness test.
 *
 *   pnpm test:peppol
 *
 * They are NOT committed: the Peppol BIS "Statement of copyright" says the
 * specification may not be redistributed without OpenPeppol AISBL's consent,
 * and the examples repository has no license file. See
 * test/fixtures/peppol/README.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE =
  'https://raw.githubusercontent.com/OpenPEPPOL/peppol-bis-invoice-3/master/rules/examples/';
const FILES = [
  'base-example.xml',
  'Allowance-example.xml',
  'Vat-category-S.xml',
  'vat-category-E.xml',
  'vat-category-O.xml',
  'vat-category-Z.xml',
  'base-creditnote-correction.xml',
  'base-negative-inv-correction.xml',
];

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../test/fixtures/peppol');
mkdirSync(dir, { recursive: true });

let failed = 0;
for (const file of FILES) {
  try {
    const res = await fetch(BASE + file);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(join(dir, file), await res.text());
    console.log(`fetched ${file}`);
  } catch (err) {
    failed++;
    console.error(`could not fetch ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
console.log(`\nSaved to ${dir} (not committed; © OpenPeppol AISBL).`);
if (failed > 0) process.exitCode = 1;
