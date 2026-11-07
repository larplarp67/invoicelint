/**
 * Opt-in robustness test on OpenPeppol's official example invoices.
 * Skipped unless `pnpm test:peppol` has downloaded them (they are not
 * committed; see test/fixtures/peppol/README.md).
 *
 * They are European invoices, so the point is not "no findings" but: parsing
 * never crashes, and the output is sensible (currency warning, other-tax notes,
 * no false math or registration-number errors).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validate } from '../src/index.ts';

const DIR = join(import.meta.dirname, 'fixtures', 'peppol');
const files = existsSync(DIR)
  ? readdirSync(DIR)
      .filter((f) => f.endsWith('.xml'))
      .sort()
  : [];

describe.skipIf(files.length === 0)('official Peppol examples (run `pnpm test:peppol`)', () => {
  it.each(files)('%s', (file) => {
    const xml = readFileSync(join(DIR, file), 'utf8');
    const report = validate(xml);
    const all = [...report.errors, ...report.warnings, ...report.infos];
    const ids = new Set(all.map((i) => i.ruleId));
    expect(report.format).toBe('ubl');

    if (ids.has('PARSE-UBL-010')) {
      expect(report).toMatchObject({ ok: true, packs: [] }); // credit note: recognized, skipped
      return;
    }
    expect(report.errors.filter((i) => i.ruleId.startsWith('PARSE'))).toEqual([]);
    expect(report.packs.map((p) => p.id)).toEqual(['ca-gst-hst']);
    expect(ids.has('CA-CUR-001')).toBe(true); // none of the examples is in CAD
    // Sensible: European VAT numbers and allowances must not produce false
    // registration-number or math errors.
    expect([...ids].filter((id) => id.startsWith('CA-BN'))).toEqual([]);
    expect(report.errors).toEqual([]);
  });
});
