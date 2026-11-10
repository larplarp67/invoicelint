import { describe, expect, it } from 'vitest';
import { formatAmount } from '../../../src/packs/ca-gst-hst/context.ts';
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

describe('amounts in messages use the invoice currency', () => {
  it('formats CAD with "$" and other currencies with their code', () => {
    expect(formatAmount(123456, 'CAD')).toBe('$1,234.56');
    expect(formatAmount(177400, 'SEK')).toBe('1,774.00 SEK');
    expect(formatAmount(-500, 'EUR')).toBe('-5.00 EUR');
  });

  it('a USD invoice states its total in USD, while the thresholds stay in CAD', () => {
    const report = check({ ...tier2, currency: 'USD', supplier: { name: 'S' } });
    expect(byRule(report, 'CA-ITC-010')[0]?.message).toMatch(
      /^This invoice totals 250\.00 USD including tax\. Invoices of \$100 or more/,
    );
    expect(byRule(report, 'CA-TIER-001')[0]?.message).toMatch(
      /the total of 250\.00 USD including tax is between \$100 and \$499\.99/,
    );
  });

  it('math messages use the invoice currency too', () => {
    const report = check({ ...tier2, currency: 'EUR', total: '251.00' });
    expect(byRule(report, 'CA-MATH-002')[0]?.message).toBe(
      'The subtotal (221.24 EUR) plus taxes (28.76 EUR) come to 250.00 EUR, but the total says 251.00 EUR (a difference of 1.00 EUR).',
    );
  });
});

describe('CA-TOTAL-001 negative total (refund or credit note)', () => {
  const refund = {
    ...tier2,
    invoiceNumber: 'R1',
    lines: [
      { description: 'Refund: printing', lineTotal: '-221.24', taxStatus: 'taxable' as const },
    ],
    subtotal: '-221.24',
    taxes: [{ type: 'HST' as const, rate: 13, taxableAmount: '-221.24', amount: '-28.76' }],
    total: '-250.00',
  };

  it('notes the negative total, and the report has no tier', () => {
    const report = check(refund);
    expect(report.tier).toBeUndefined();
    expect(report.ok).toBe(true);
    expect(findings(report)).toEqual([]);
    expect(report.infos.map((i) => i.ruleId)).toEqual(['CA-TOTAL-001']);
    expect(byRule(report, 'CA-TOTAL-001')[0]).toMatchObject({
      severity: 'info',
      field: 'total',
      citation: 'ETA s.232(3); SOR/91-44',
    });
    expect(byRule(report, 'CA-TOTAL-001')[0]?.message).toMatch(
      /^The total is -\$250\.00\. A negative total looks like a refund or credit note/,
    );
  });

  it('skips every tier rule: nothing is required of a refund by tier', () => {
    // Positive, this would be tier 3 with no supplier name, date, GST/HST number,
    // buyer or terms, before the 2021 threshold change.
    const bare = check({
      total: '-600.00',
      lines: [{ description: 'x', lineTotal: '-600.00' }],
      subtotal: '-600.00',
      supplier: { gstHstNumber: '812345676' },
    });
    expect(findings(bare)).toEqual([]);
    expect(bare.infos.map((i) => i.ruleId)).toEqual(['CA-TOTAL-001']);
    expect(findings(check({ ...refund, issueDate: '2020-01-01' }))).toEqual([]);
    expect(byRule(check({ ...refund, issueDate: '2020-01-01' }), 'CA-TIER-002')).toEqual([]);
  });

  it('still checks the math, the rate and the GST/HST number', () => {
    expect(findings(check({ ...refund, total: '-251.00' }))).toEqual(['CA-MATH-002']);
    expect(
      findings(
        check({
          ...refund,
          taxes: [{ type: 'GST', rate: 7, taxableAmount: '-221.24', amount: '-15.49' }],
          total: '-236.73',
        }),
      ),
    ).toEqual(['CA-RATE-001']);
    const typo = { ...refund, supplier: { ...refund.supplier, gstHstNumber: '812345677RT0001' } };
    expect(findings(check(typo))).toEqual(['CA-BN-001']);
  });

  it('still warns about a foreign currency, without the tier wording', () => {
    const [issue] = byRule(check({ ...refund, currency: 'USD' }), 'CA-CUR-001');
    expect(issue?.message).toBe(
      'This document is in USD. For GST/HST, amounts in another currency are converted to Canadian dollars.',
    );
    expect(issue?.fix).not.toMatch(/tier/);
  });

  it('a zero total is still an invoice (tier 1)', () => {
    const report = check({ total: '0.00' });
    expect(report.tier).toBe(1);
    expect(byRule(report, 'CA-TOTAL-001')).toEqual([]);
  });
});
