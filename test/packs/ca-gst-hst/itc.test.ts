import { describe, expect, it } from 'vitest';
import type { InvoiceInput } from '../../../src/model.ts';
import { byRule, check, findings, tier2, tier3 } from '../../helpers/ca.ts';

const without = <K extends keyof InvoiceInput>(
  inv: InvoiceInput,
  key: K,
): Omit<InvoiceInput, K> => {
  const { [key]: _omitted, ...rest } = inv;
  return rest;
};

describe('baseline', () => {
  it('the complete tier-2 and tier-3 helpers have no findings', () => {
    expect(findings(check(tier2))).toEqual([]);
    expect(findings(check(tier3))).toEqual([]);
  });
});

describe('CA-ITC-001 supplier or intermediary name', () => {
  it('warns when neither is named, at tier 1', () => {
    const report = check({ issueDate: '2026-01-05', total: '20.00' });
    expect(findings(report)).toEqual(['CA-ITC-001']);
    expect(byRule(report, 'CA-ITC-001')[0]).toMatchObject({
      severity: 'warning',
      field: 'supplier.name',
      citation: 'SOR/91-45 s.3(a)(i)',
    });
  });

  it("accepts an intermediary's name instead", () => {
    const report = check({ issueDate: '2026-01-05', intermediary: { name: 'Agent' }, total: 20 });
    expect(byRule(report, 'CA-ITC-001')).toEqual([]);
  });
});

describe('CA-ITC-002 date', () => {
  it('warns with no invoice date and no tax-paid date', () => {
    expect(findings(check({ supplier: { name: 'S' }, total: 20 }))).toEqual(['CA-ITC-002']);
  });

  it('accepts taxPaidDate for a receipt with no invoice date', () => {
    const report = check({ supplier: { name: 'S' }, taxPaidDate: '2026-01-05', total: 20 });
    expect(byRule(report, 'CA-ITC-002')).toEqual([]);
  });
});

describe('CA-ITC-010 registration number of the party named', () => {
  it('warns at tier 2 when no number is shown', () => {
    const report = check({ ...tier2, supplier: { name: 'Supplier Inc.' } });
    expect(findings(report)).toEqual(['CA-ITC-010']);
    expect(byRule(report, 'CA-ITC-010')[0]?.message).toMatch(/totals \$250\.00 including tax/);
  });

  it('does not apply at tier 1', () => {
    const report = check({
      ...tier2,
      supplier: { name: 'S' },
      subtotal: undefined,
      taxes: [],
      lines: [],
      total: '99.99',
    });
    expect(byRule(report, 'CA-ITC-010')).toEqual([]);
  });

  it("supplier's name and number satisfy it even when an intermediary is named without one", () => {
    const report = check({ ...tier2, intermediary: { name: 'Marketplace Inc.' } });
    expect(byRule(report, 'CA-ITC-010')).toEqual([]);
  });

  it("intermediary's name and number satisfy it", () => {
    const report = check({
      ...tier2,
      supplier: {},
      intermediary: { name: 'Marketplace Inc.', gstHstNumber: '812345676RT0001' },
    });
    expect(byRule(report, 'CA-ITC-010')).toEqual([]);
  });

  it('points at the intermediary when only the intermediary is named', () => {
    const report = check({ ...tier2, supplier: {}, intermediary: { name: 'Marketplace Inc.' } });
    expect(byRule(report, 'CA-ITC-010')[0]?.field).toBe('intermediary.gstHstNumber');
  });

  it("does not accept an unnamed party's number for the named one", () => {
    const report = check({
      ...tier2,
      supplier: { gstHstNumber: '812345676RT0001' },
      intermediary: { name: 'Marketplace Inc.' },
    });
    expect(byRule(report, 'CA-ITC-010')[0]?.field).toBe('intermediary.gstHstNumber');
  });
});

describe('CA-ITC-011 tax disclosure', () => {
  it('warns when neither a GST/HST amount nor a tax-included statement is shown', () => {
    const report = check({ ...tier2, taxes: [], subtotal: '250.00' });
    expect(findings(report)).toEqual(['CA-ITC-011']);
  });

  it('PST alone is not GST/HST disclosure', () => {
    const report = check({
      ...tier2,
      taxes: [{ type: 'PST', rate: 7, taxableAmount: '233.64', amount: '16.36' }],
      lines: [{ description: 'Printing', lineTotal: '233.64' }],
      subtotal: '233.64',
    });
    expect(findings(report)).toEqual(['CA-ITC-011']);
  });

  it('a tax-included statement with a rate satisfies it', () => {
    const report = check({
      ...without(tier2, 'subtotal'),
      taxes: [],
      lines: [{ description: 'Printing', lineTotal: '250.00' }],
      taxIncludedStatement: { included: true, rate: 13 },
    });
    expect(findings(report)).toEqual([]);
  });

  it('is skipped when every line is stated exempt or zero-rated', () => {
    const report = check({
      ...tier2,
      taxes: [],
      lines: [{ description: 'Basic groceries', lineTotal: '250.00', taxStatus: 'zero-rated' }],
      subtotal: '250.00',
    });
    expect(byRule(report, 'CA-ITC-011')).toEqual([]);
  });
});

describe('CA-ITC-012 tax-included rate', () => {
  it('warns when the statement has no rate', () => {
    const report = check({
      ...without(tier2, 'subtotal'),
      taxes: [],
      lines: [{ description: 'Printing', lineTotal: '300.00' }],
      taxIncludedStatement: { included: true },
      total: '300.00',
    });
    expect(findings(report)).toEqual(['CA-ITC-012']);
    expect(byRule(report, 'CA-ITC-012')[0]?.field).toBe('taxIncludedStatement.rate');
  });
});

describe('CA-ITC-013 status of each taxable supply', () => {
  const mixed = (lines: InvoiceInput['lines']): InvoiceInput => ({
    ...tier2,
    lines,
    subtotal: '221.24',
  });

  it('warns on an unmarked line when another line is marked exempt', () => {
    const report = check(
      mixed([
        { description: 'Consulting', lineTotal: '121.24' },
        { description: 'Membership dues', lineTotal: '100.00', taxStatus: 'exempt' },
      ]),
    );
    expect(findings(report)).toEqual(['CA-ITC-013']);
    expect(byRule(report, 'CA-ITC-013').map((i) => i.field)).toEqual(['lines[0].taxStatus']);
  });

  it('does not warn when every line is marked', () => {
    const report = check(
      mixed([
        { description: 'Consulting', lineTotal: '121.24', taxStatus: 'taxable' },
        { description: 'Dues', lineTotal: '100.00', taxStatus: 'exempt' },
      ]),
    );
    expect(byRule(report, 'CA-ITC-013')).toEqual([]);
  });

  it('does not warn when nothing shows the statuses differ', () => {
    // All unmarked, or marked taxable plus unmarked: no line carries no-tax status.
    for (const second of [undefined, 'taxable'] as const) {
      const report = check(
        mixed([
          { description: 'Consulting', lineTotal: '121.24' },
          {
            description: 'Printing',
            lineTotal: '100.00',
            ...(second ? { taxStatus: second } : {}),
          },
        ]),
      );
      expect(byRule(report, 'CA-ITC-013')).toEqual([]);
    }
  });

  it('needs two or more supplies', () => {
    const report = check(mixed([{ description: 'Consulting', lineTotal: '221.24' }]));
    expect(byRule(report, 'CA-ITC-013')).toEqual([]);
  });
});

describe('CA-ITC-020/021 buyer name and terms (tier 3 only)', () => {
  it('warns when the buyer name is missing', () => {
    expect(findings(check(without(tier3, 'buyer')))).toEqual(['CA-ITC-020']);
  });

  it("accepts the buyer's trading name", () => {
    expect(findings(check({ ...tier3, buyer: { tradingName: 'Buyer' } }))).toEqual([]);
  });

  it('warns when payment terms are missing', () => {
    expect(findings(check(without(tier3, 'paymentTerms')))).toEqual(['CA-ITC-021']);
  });

  it('do not apply at tier 2', () => {
    expect(findings(check(without(without(tier2, 'paymentTerms'), 'buyer')))).toEqual([]);
  });
});

describe('CA-ITC-022 description of each supply (tier 3)', () => {
  it('warns on missing and near-empty descriptions, notes generic ones', () => {
    const report = check({
      ...tier3,
      lines: [
        { lineTotal: '100.00', taxStatus: 'taxable' },
        { description: 'xy', lineTotal: '100.00', taxStatus: 'taxable' },
        { description: 'Services', lineTotal: '100.00', taxStatus: 'taxable' },
        { description: 'Misc.', lineTotal: '100.00', taxStatus: 'taxable' },
        { description: 'Laptop repair, 2 hours', lineTotal: '130.97', taxStatus: 'taxable' },
      ],
    });
    const issues = byRule(report, 'CA-ITC-022');
    expect(issues.map((i) => [i.field, i.severity])).toEqual([
      ['lines[0].description', 'warning'],
      ['lines[1].description', 'warning'],
      ['lines[2].description', 'info'],
      ['lines[3].description', 'info'],
    ]);
    expect(issues[0]?.message).toMatch(/Line 1 has no description/);
  });

  it('warns when a tier-3 invoice lists no supplies at all', () => {
    const report = check({ ...without(tier3, 'subtotal'), lines: [] });
    expect(byRule(report, 'CA-ITC-022')[0]).toMatchObject({ field: 'lines', severity: 'warning' });
  });
});

describe('severity policy', () => {
  it('missing ITC information never makes the report fail', () => {
    const report = check({ total: '1000.00' });
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    for (const w of report.warnings) expect(w.message).not.toMatch(/illegal/i);
  });
});
