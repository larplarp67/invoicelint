/**
 * Sanity checks for the shared valid fixtures (reused by the Phase 3 rule tests).
 * These assert the fixtures are internally consistent, not that rules pass.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { multiplyCents, percentOf } from '../src/money.ts';
import { validateRegistrationNumber } from '../src/packs/ca-gst-hst/bn.ts';
import { parseJsonInvoice } from '../src/parsers/json.ts';

const DIR = join(import.meta.dirname, 'fixtures', 'valid');

function load(file: string) {
  const result = parseJsonInvoice(readFileSync(join(DIR, file), 'utf8'));
  if (!result.ok) throw new Error(`${file}: ${JSON.stringify(result.parseErrors, null, 2)}`);
  return result.invoice;
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));

describe('valid fixtures', () => {
  it('has one fixture per tier', () => {
    const tiers = files.map((f) => f.split('-')[0]).sort();
    expect(tiers).toEqual(['tier1', 'tier2', 'tier3']);
  });

  it.each([
    ['tier1-ab-receipt-45.json', 0, 9999],
    ['tier2-on-invoice-250.json', 10000, 49999],
    ['tier3-bc-invoice-1200.json', 50000, Number.MAX_SAFE_INTEGER],
  ])('%s total falls in its tier', (file, min, max) => {
    const { total } = load(file);
    expect(total).toBeGreaterThanOrEqual(min);
    expect(total).toBeLessThanOrEqual(max);
  });

  it.each(files)('%s adds up exactly', (file) => {
    const inv = load(file);
    for (const line of inv.lines) {
      if (line.unitPrice !== undefined && line.quantity !== undefined) {
        expect(multiplyCents(line.unitPrice, line.quantity)).toBe(line.lineTotal);
      }
    }
    const lineSum = inv.lines.reduce((sum, l) => sum + l.lineTotal, 0);
    expect(lineSum).toBe(inv.subtotal);
    for (const tax of inv.taxes) {
      expect(tax.rate, `${tax.type} rate`).toBeDefined();
      expect(tax.taxableAmount).toBe(inv.subtotal);
      expect(percentOf(tax.taxableAmount ?? 0, tax.rate ?? '0')).toBe(tax.amount);
    }
    const taxSum = inv.taxes.reduce((sum, t) => sum + t.amount, 0);
    expect((inv.subtotal ?? 0) + taxSum).toBe(inv.total);
  });

  it.each(files)('%s has a well-formed registration number when present', (file) => {
    const bn = load(file).supplier.gstHstNumber;
    if (bn !== undefined) expect(validateRegistrationNumber(bn).problems).toEqual([]);
  });
});
