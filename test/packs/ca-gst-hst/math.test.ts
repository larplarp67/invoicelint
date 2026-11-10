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

describe('CA-MATH-002 with document-level allowances and charges', () => {
  // Lines 221.24, 10.00 discount, 5.00 freight -> taxable 216.24, HST 13% = 28.11, total 244.35
  const adjusted = {
    ...tier2,
    allowanceTotal: '10.00',
    chargeTotal: '5.00',
    taxes: [{ type: 'HST' as const, rate: 13, taxableAmount: '216.24', amount: '28.11' }],
    total: '244.35',
  };

  it('subtracts allowances and adds charges', () => {
    expect(findings(check(adjusted))).toEqual([]);
  });

  it('names the allowances and charges in the message when the total is off', () => {
    const report = check({ ...adjusted, total: '254.35' });
    expect(byRule(report, 'CA-MATH-002')[0]?.message).toBe(
      'The subtotal ($221.24) minus allowances ($10.00) plus charges ($5.00) plus taxes ($28.11) come to $244.35, but the total says $254.35 (a difference of $10.00).',
    );
  });

  it('ignoring the allowance would be an error', () => {
    const { allowanceTotal: _a, chargeTotal: _c, ...noAdjustments } = adjusted;
    expect(findings(check(noAdjustments))).toEqual(['CA-MATH-002']);
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

  it('calls an OTHER tax "Tax" in messages and does not treat it as GST/HST', () => {
    const report = check({
      ...tier2,
      taxes: [
        { type: 'HST', rate: 13, taxableAmount: '221.24', amount: '28.76' },
        { type: 'OTHER', rate: 25, taxableAmount: '100.00', amount: '20.00' },
      ],
      total: '270.00',
    });
    expect(byRule(report, 'CA-MATH-003')[0]?.message).toBe(
      'Tax at 25% of $100.00 is $25.00, but the invoice shows $20.00.',
    );
    expect(byRule(report, 'CA-RATE-002')).toEqual([]);
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

describe('CA-MATH-005 GST/HST charged on lines marked exempt or zero-rated', () => {
  /** $110 zero-rated groceries + $50 taxable items, HST charged on `taxableAmount`. */
  const groceries = (taxableAmount: string, amount: string, total: string) => ({
    ...tier2,
    lines: [
      { description: 'Basic groceries', lineTotal: '110.00', taxStatus: 'zero-rated' as const },
      { description: 'Paper towels', lineTotal: '30.00', taxStatus: 'taxable' as const },
      { description: 'Sparkling water', lineTotal: '20.00', taxStatus: 'taxable' as const },
    ],
    subtotal: '160.00',
    taxes: [{ type: 'HST' as const, rate: 13, taxableAmount, amount }],
    total,
  });

  it('warns when HST is charged on the zero-rated line too', () => {
    const report = check(groceries('160.00', '20.80', '180.80'));
    expect(findings(report)).toEqual(['CA-MATH-005']);
    expect(report.ok).toBe(true); // a warning: the statuses or the tax could be wrong
    expect(byRule(report, 'CA-MATH-005')).toEqual([
      expect.objectContaining({
        severity: 'warning',
        field: 'taxes[0].taxableAmount',
        message:
          'HST is charged on $160.00, but the lines not marked exempt or zero-rated add up to $50.00: line 1 ("Basic groceries") is marked zero-rated. Exempt and zero-rated items carry no GST/HST, so either a line status or the amount taxed is wrong.',
      }),
    ]);
  });

  it('is silent when HST is charged on the taxable lines only, or less', () => {
    expect(findings(check(groceries('50.00', '6.50', '166.50')))).toEqual([]);
    expect(byRule(check(groceries('40.00', '5.20', '165.20')), 'CA-MATH-005')).toEqual([]);
  });

  it('counts unmarked lines as possibly taxable (CA-ITC-013 asks for the marking)', () => {
    const report = check({
      ...tier2,
      lines: [
        { description: 'Prescription', lineTotal: '54.00', taxStatus: 'zero-rated' },
        { description: 'Electric toothbrush', lineTotal: '200.00' },
      ],
      subtotal: '254.00',
      taxes: [{ type: 'HST', rate: 13, taxableAmount: '200.00', amount: '26.00' }],
      total: '280.00',
    });
    expect(findings(report)).toEqual(['CA-ITC-013']);
  });

  it('names every line marked exempt or zero-rated', () => {
    const report = check({
      ...tier2,
      lines: [
        { description: 'Groceries', lineTotal: '100.00', taxStatus: 'zero-rated' },
        { description: 'Soap', lineTotal: '50.00', taxStatus: 'taxable' },
        { lineTotal: '20.00', taxStatus: 'exempt' },
        { description: 'Bus pass', lineTotal: '30.00', taxStatus: 'exempt' },
      ],
      subtotal: '200.00',
      taxes: [{ type: 'HST', rate: 13, taxableAmount: '200.00', amount: '26.00' }],
      total: '226.00',
    });
    expect(byRule(report, 'CA-MATH-005')[0]?.message).toContain(
      'add up to $50.00: line 1 ("Groceries") is marked zero-rated, line 3 is marked exempt, and line 4 ("Bus pass") is marked exempt.',
    );
  });

  it('allows document-level charges (e.g. freight) in the taxed amount', () => {
    const report = check({
      ...groceries('60.00', '7.80', '177.80'),
      chargeTotal: '10.00',
    });
    expect(byRule(report, 'CA-MATH-005')).toEqual([]);
    const over = check({ ...groceries('160.00', '20.80', '190.80'), chargeTotal: '10.00' });
    expect(byRule(over, 'CA-MATH-005')[0]?.message).toContain(
      'the lines not marked exempt or zero-rated ($50.00) plus charges ($10.00) come to $60.00',
    );
  });

  it('leaves the all-exempt case to CA-MATH-004', () => {
    const report = check({
      ...tier2,
      lines: [{ description: 'Basic groceries', lineTotal: '221.24', taxStatus: 'zero-rated' }],
    });
    expect(findings(report)).toEqual(['CA-MATH-004']);
  });

  it('is silent when no line is marked exempt or zero-rated', () => {
    // Lines $350, HST on $360: that is a subtotal problem (CA-MATH-001), not this one.
    const report = check({
      ...tier2,
      lines: [
        { description: 'Landing page', lineTotal: '250.00', taxStatus: 'taxable' },
        { description: 'Hosting setup', lineTotal: '100.00', taxStatus: 'taxable' },
      ],
      subtotal: '360.00',
      taxes: [{ type: 'HST', rate: 13, taxableAmount: '360.00', amount: '46.80' }],
      total: '406.80',
    });
    expect(findings(report)).toEqual(['CA-MATH-001']);
  });

  it('ignores PST and QST, whose base can differ', () => {
    const report = check({
      ...groceries('50.00', '6.50', '177.70'),
      supplier: { ...tier2.supplier, province: 'BC' },
      taxes: [
        { type: 'GST', rate: 5, taxableAmount: '50.00', amount: '2.50' },
        { type: 'PST', rate: 7, taxableAmount: '160.00', amount: '11.20' },
      ],
      total: '173.70',
    });
    expect(findings(report)).toEqual([]);
  });

  it('works on a refund: HST on -$160.00 when only -$50.00 can carry it', () => {
    const refund = {
      ...tier2,
      lines: [
        { description: 'Groceries', lineTotal: '-110.00', taxStatus: 'zero-rated' as const },
        { description: 'Soap', lineTotal: '-50.00', taxStatus: 'taxable' as const },
      ],
      subtotal: '-160.00',
    };
    const over = check({
      ...refund,
      taxes: [{ type: 'HST', rate: 13, taxableAmount: '-160.00', amount: '-20.80' }],
      total: '-180.80',
    });
    expect(findings(over)).toEqual(['CA-MATH-005']);
    const fine = check({
      ...refund,
      taxes: [{ type: 'HST', rate: 13, taxableAmount: '-50.00', amount: '-6.50' }],
      total: '-166.50',
    });
    expect(findings(fine)).toEqual([]);
  });
});
