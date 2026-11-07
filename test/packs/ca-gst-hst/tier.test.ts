import { describe, expect, it } from 'vitest';
import { computeTier } from '../../../src/packs/ca-gst-hst/tier.ts';
import { byRule, check, findings, tier2 } from '../../helpers/ca.ts';

describe('computeTier (integer cents, total including tax)', () => {
  it.each([
    [0, 1],
    [9999, 1], // $99.99
    [10000, 2], // $100.00
    [49999, 2], // $499.99
    [50000, 3], // $500.00
    [1_000_000_00, 3],
  ])('%d cents -> tier %d', (cents, tier) => {
    expect(computeTier(cents)).toBe(tier);
  });
});

describe('CA-TIER-001', () => {
  it.each([
    ['99.99', 1, 's.3(a)'],
    ['100.00', 2, 's.3(b)'],
    ['499.99', 2, 's.3(b)'],
    ['500.00', 3, 's.3(c)'],
  ])('total %s -> tier %d', (total, tier, paragraph) => {
    const report = check({ total });
    expect(report.tier).toBe(tier);
    const [info] = byRule(report, 'CA-TIER-001');
    expect(info?.severity).toBe('info');
    expect(info?.message).toContain(`Tier ${tier}:`);
    expect(info?.message).toContain(paragraph);
  });

  it('counts tax: $95.00 + 13% HST = $107.35 is tier 2', () => {
    const report = check({
      subtotal: '95.00',
      taxes: [{ type: 'HST', rate: 13, taxableAmount: '95.00', amount: '12.35' }],
      total: '107.35',
    });
    expect(report.tier).toBe(2);
  });
});

describe('CA-TIER-002', () => {
  it('notes invoices dated before 2021-04-20', () => {
    const [info] = byRule(check({ ...tier2, issueDate: '2021-04-19' }), 'CA-TIER-002');
    expect(info).toMatchObject({ severity: 'info', field: 'issueDate' });
    expect(info?.message).toMatch(/\$30 and \$150/);
  });

  it('is silent from 2021-04-20 onward and when there is no date', () => {
    expect(byRule(check({ ...tier2, issueDate: '2021-04-20' }), 'CA-TIER-002')).toEqual([]);
    expect(byRule(check({ total: 1 }), 'CA-TIER-002')).toEqual([]);
  });

  it('falls back to taxPaidDate when there is no invoice date', () => {
    const { issueDate: _ignored, ...noDate } = tier2;
    const [info] = byRule(check({ ...noDate, taxPaidDate: '2019-05-01' }), 'CA-TIER-002');
    expect(info?.field).toBe('taxPaidDate');
  });
});

describe('CA-CUR-001', () => {
  it('warns when the currency is not CAD', () => {
    const report = check({ ...tier2, currency: 'USD' });
    expect(findings(report)).toEqual(['CA-CUR-001']);
    expect(report.ok).toBe(true); // a warning, not an error
    expect(byRule(report, 'CA-CUR-001')[0]?.message).toMatch(/in USD/);
  });

  it('is silent for CAD (the default)', () => {
    expect(byRule(check({ total: 1 }), 'CA-CUR-001')).toEqual([]);
  });
});
