import { describe, expect, it } from 'vitest';
import { byRule, check, findings, tier2 } from '../../helpers/ca.ts';

describe('CA-MATH-001 lines add up to the subtotal', () => {
  it('errors when lines sum to $200 but the subtotal says $210', () => {
    const report = check({
      ...tier2,
      lines: [
        { description: 'A', lineTotal: '120.00', taxStatus: 'taxable' },
        { description: 'B', lineTotal: '80.00', taxStatus: 'taxable' },
      ],
      subtotal: '210.00',
      taxes: [{ type: 'HST', rate: 13, taxableAmount: '210.00', amount: '27.30' }],
      total: '237.30',
    });
    expect(findings(report)).toEqual(['CA-MATH-001']);
    expect(byRule(report, 'CA-MATH-001')[0]?.message).toBe(
      'The line amounts add up to $200.00, but the subtotal says $210.00 (a difference of $10.00).',
    );
  });

  it('is exact: a 1-cent difference is an error', () => {
    const report = check({ ...tier2, subtotal: '221.25', total: '250.01' });
    expect(byRule(report, 'CA-MATH-001')[0]?.severity).toBe('error');
  });

  it('notes when it is skipped', () => {
    const noSubtotal = check({ ...tier2, subtotal: undefined });
    expect(byRule(noSubtotal, 'CA-MATH-001')[0]).toMatchObject({
      severity: 'info',
      field: 'subtotal',
    });
    const noLines = check({ ...tier2, lines: [] });
    expect(byRule(noLines, 'CA-MATH-001')[0]).toMatchObject({ severity: 'info', field: 'lines' });
  });
});

describe('CA-MATH-002 subtotal + taxes = total', () => {
  it('errors when the total is off by $1.00', () => {
    const report = check({ ...tier2, total: '251.00' });
    expect(findings(report)).toEqual(['CA-MATH-002']);
    expect(byRule(report, 'CA-MATH-002')[0]?.message).toMatch(/a difference of \$1\.00/);
  });

  it('allows the tolerance per tax line (default 1 cent)', () => {
    expect(byRule(check({ ...tier2, total: '250.01' }), 'CA-MATH-002')).toEqual([]);
    expect(findings(check({ ...tier2, total: '250.02' }))).toEqual(['CA-MATH-002']);
    expect(findings(check({ ...tier2, total: '250.02' }, 2))).toEqual([]);
    expect(findings(check({ ...tier2, total: '250.01' }, 0))).toEqual(['CA-MATH-002']);
  });

  it('uses the line sum when there is no subtotal', () => {
    const report = check({ ...tier2, subtotal: undefined, total: '260.00' });
    expect(byRule(report, 'CA-MATH-002')[0]?.message).toMatch(/^The lines \(\$221\.24\)/);
  });

  it('is skipped (info) for tax-included invoices', () => {
    const report = check({
      ...tier2,
      taxes: [],
      subtotal: undefined,
      lines: [{ description: 'Printing', lineTotal: '250.00' }],
      taxIncludedStatement: { included: true, rate: 13 },
    });
    expect(byRule(report, 'CA-MATH-002')[0]?.severity).toBe('info');
    expect(findings(report)).toEqual([]);
  });

  it('is skipped (info) with no subtotal and no lines', () => {
    const report = check({ ...tier2, subtotal: undefined, lines: [] });
    expect(byRule(report, 'CA-MATH-002')[0]?.severity).toBe('info');
  });
});

describe('CA-MATH-003 tax = rate × taxable amount', () => {
  it('errors on HST 13% of $100 shown as $15.00', () => {
    const report = check({
      ...tier2,
      lines: [{ description: 'Printing', lineTotal: '100.00', taxStatus: 'taxable' }],
      subtotal: '100.00',
      taxes: [{ type: 'HST', rate: 13, taxableAmount: '100.00', amount: '15.00' }],
      total: '115.00',
    });
    expect(findings(report)).toEqual(['CA-MATH-003']);
    expect(byRule(report, 'CA-MATH-003')[0]).toMatchObject({
      field: 'taxes[0].amount',
      message: 'HST at 13% of $100.00 is $13.00, but the invoice shows $15.00.',
    });
  });

  it('accepts a 1-cent rounding difference by default', () => {
    // 13% of 221.24 = 28.7612 -> 28.76; 28.77 is within tolerance.
    const report = check({
      ...tier2,
      taxes: [{ type: 'HST', rate: 13, taxableAmount: '221.24', amount: '28.77' }],
      total: '250.01',
    });
    expect(findings(report)).toEqual([]);
  });

  it('checks PST and QST math too', () => {
    const report = check({
      ...tier2,
      taxes: [
        { type: 'GST', rate: 5, taxableAmount: '221.24', amount: '11.06' },
        { type: 'QST', rate: '9.975', taxableAmount: '221.24', amount: '25.00' },
      ],
      total: '257.30',
    });
    expect(byRule(report, 'CA-MATH-003').map((i) => i.field)).toEqual(['taxes[1].amount']);
  });

  it('notes each tax line it cannot check', () => {
    const report = check({
      ...tier2,
      taxes: [
        { type: 'HST', amount: '28.76' },
        { type: 'PST', rate: 7, amount: '0.00' },
      ],
      total: '250.00',
    });
    expect(byRule(report, 'CA-MATH-003').map((i) => [i.field, i.severity])).toEqual([
      ['taxes[0]', 'info'],
      ['taxes[1]', 'info'],
    ]);
  });
});

describe('CA-MATH-004 tax charged on exempt / zero-rated supplies', () => {
  it('warns when every line is zero-rated but HST is charged', () => {
    const report = check({
      ...tier2,
      lines: [{ description: 'Basic groceries', lineTotal: '221.24', taxStatus: 'zero-rated' }],
    });
    expect(findings(report)).toEqual(['CA-MATH-004']);
    expect(byRule(report, 'CA-MATH-004')[0]?.severity).toBe('warning');
  });

  it('is silent when any line is taxable or unstated', () => {
    for (const taxStatus of ['taxable', undefined] as const) {
      const report = check({
        ...tier2,
        lines: [
          { description: 'Groceries', lineTotal: '121.24', taxStatus: 'zero-rated' },
          { description: 'Paper', lineTotal: '100.00', ...(taxStatus ? { taxStatus } : {}) },
        ],
      });
      expect(byRule(report, 'CA-MATH-004')).toEqual([]);
    }
  });

  it('ignores a GST/HST line of $0.00', () => {
    const report = check({
      ...tier2,
      lines: [{ description: 'Groceries', lineTotal: '250.00', taxStatus: 'zero-rated' }],
      subtotal: '250.00',
      taxes: [{ type: 'HST', rate: 0, taxableAmount: '250.00', amount: '0.00' }],
    });
    expect(byRule(report, 'CA-MATH-004')).toEqual([]);
  });
});
