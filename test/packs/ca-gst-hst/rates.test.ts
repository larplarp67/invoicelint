import { describe, expect, it } from 'vitest';
import { caGstHstPack } from '../../../src/packs/ca-gst-hst/index.ts';
import {
  COVERAGE_FROM,
  RATES_SOURCE,
  RATE_TABLE,
  ratesOn,
} from '../../../src/packs/ca-gst-hst/rates.ts';
import { byRule, check, findings, tier2 } from '../../helpers/ca.ts';

describe('rate table', () => {
  it('cites its source and retrieval date', () => {
    expect(RATES_SOURCE.url).toMatch(/^https:\/\/www\.canada\.ca\//);
    expect(RATES_SOURCE.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('matches the CRA table for the covered periods', () => {
    const at = (date: string, province: string) =>
      RATE_TABLE.find(
        (e) =>
          e.jurisdiction === province &&
          e.effectiveFrom <= date &&
          (e.effectiveTo === undefined || date <= e.effectiveTo),
      );
    expect(at('2025-03-31', 'NS')).toMatchObject({ type: 'HST', rate: '15' });
    expect(at('2025-04-01', 'NS')).toMatchObject({ type: 'HST', rate: '14' });
    expect(at('2017-01-01', 'ON')).toMatchObject({ type: 'HST', rate: '13' });
    expect(at('2017-01-01', 'PE')).toMatchObject({ type: 'HST', rate: '15' });
    expect(at('2026-11-07', 'QC')).toMatchObject({ type: 'GST', rate: '5' });
    expect(at('2026-11-07', 'BC')).toMatchObject({ type: 'GST', rate: '5' });
  });

  it('covers every province and territory on every covered date', () => {
    for (const date of [COVERAGE_FROM, '2025-03-31', '2025-04-01', '2030-01-01']) {
      const provinces = RATE_TABLE.filter(
        (e) => e.effectiveFrom <= date && (e.effectiveTo === undefined || date <= e.effectiveTo),
      ).map((e) => e.jurisdiction);
      expect(provinces.sort(), date).toHaveLength(13);
      expect(new Set(provinces).size, date).toBe(13);
    }
  });

  it.each([
    ['2017-01-01', 'HST', ['13', '15']],
    ['2025-03-15', 'HST', ['13', '15']],
    ['2025-03-31', 'HST', ['13', '15']],
    ['2025-04-01', 'HST', ['13', '14', '15']],
    ['2025-04-15', 'HST', ['13', '14', '15']],
    ['2026-11-07', 'GST', ['5']],
  ] as const)('ratesOn(%s, %s) = %j', (date, type, expected) => {
    expect(ratesOn(date, type)).toEqual(expected);
  });

  it('is part of every rule context', () => {
    const ctx = caGstHstPack.createContext(tier2 as never, { toleranceCents: 1 });
    expect(ctx.rates.ratesOn('2025-04-15', 'HST')).toEqual(['13', '14', '15']);
  });
});

const hstInvoice = (rate: number, issueDate: string) => ({
  ...tier2,
  issueDate,
  lines: [{ description: 'Printing', lineTotal: '200.00', taxStatus: 'taxable' as const }],
  subtotal: '200.00',
  taxes: [{ type: 'HST' as const, rate, taxableAmount: '200.00', amount: (2 * rate).toFixed(2) }],
  total: (200 + 2 * rate).toFixed(2),
});

describe('CA-RATE-001 GST rate', () => {
  it('errors on GST at 7%', () => {
    const report = check({
      ...tier2,
      supplier: { ...tier2.supplier, province: 'AB' },
      lines: [{ description: 'Printing', lineTotal: '200.00', taxStatus: 'taxable' }],
      subtotal: '200.00',
      taxes: [{ type: 'GST', rate: 7, taxableAmount: '200.00', amount: '14.00' }],
      total: '214.00',
    });
    expect(findings(report)).toEqual(['CA-RATE-001']);
    expect(byRule(report, 'CA-RATE-001')[0]).toMatchObject({
      field: 'taxes[0].rate',
      message: 'GST is charged at 7%, but the GST rate on 2026-04-02 was 5%.',
    });
  });

  it('accepts 5%, written as "5.0"', () => {
    const report = check({
      ...tier2,
      lines: [{ description: 'Printing', lineTotal: '200.00', taxStatus: 'taxable' }],
      subtotal: '200.00',
      taxes: [{ type: 'GST', rate: '5.0', taxableAmount: '200.00', amount: '10.00' }],
      total: '210.00',
    });
    expect(findings(report)).toEqual([]);
  });
});

describe('CA-RATE-002 HST rate', () => {
  it('errors on HST 14% dated 2025-03-15 (Nova Scotia was still 15%)', () => {
    const report = check(hstInvoice(14, '2025-03-15'));
    expect(findings(report)).toEqual(['CA-RATE-002']);
    expect(byRule(report, 'CA-RATE-002')[0]?.message).toBe(
      'HST is charged at 14%, but on 2025-03-15 no province had an HST rate of 14%. HST rates in force that day: 13% and 15%.',
    );
  });

  it('accepts HST 14% dated 2025-04-15', () => {
    expect(findings(check(hstInvoice(14, '2025-04-15')))).toEqual([]);
  });

  it('switches exactly on 2025-04-01', () => {
    expect(findings(check(hstInvoice(14, '2025-03-31')))).toEqual(['CA-RATE-002']);
    expect(findings(check(hstInvoice(14, '2025-04-01')))).toEqual([]);
  });

  it('errors on a rate no province ever had', () => {
    expect(findings(check(hstInvoice(12, '2026-01-10')))).toEqual(['CA-RATE-002']);
  });

  it('uses taxPaidDate when there is no invoice date', () => {
    const { issueDate: _drop, ...rest } = hstInvoice(14, '2025-03-15');
    expect(findings(check({ ...rest, taxPaidDate: '2025-03-15' }))).toEqual(['CA-RATE-002']);
  });

  it('does not check PST or QST rates', () => {
    const report = check({
      ...tier2,
      lines: [{ description: 'Printing', lineTotal: '200.00', taxStatus: 'taxable' }],
      subtotal: '200.00',
      taxes: [
        { type: 'GST', rate: 5, taxableAmount: '200.00', amount: '10.00' },
        { type: 'PST', rate: 99, taxableAmount: '200.00', amount: '198.00' },
      ],
      total: '408.00',
    });
    expect(findings(report)).toEqual([]);
  });
});

describe('CA-RATE-003 rate checks skipped', () => {
  it('notes invoices dated before 2017-01-01 and skips the rate checks', () => {
    const report = check(hstInvoice(12, '2016-12-31'));
    expect(findings(report)).toEqual([]);
    expect(byRule(report, 'CA-RATE-003')[0]).toMatchObject({
      severity: 'info',
      field: 'issueDate',
    });
  });

  it('notes invoices with no date', () => {
    const { issueDate: _drop, ...rest } = hstInvoice(13, '2026-01-01');
    const report = check(rest);
    expect(byRule(report, 'CA-RATE-003')[0]?.message).toMatch(/has no date/);
  });

  it('is silent when there is no GST/HST rate to check', () => {
    expect(byRule(check({ total: 1 }), 'CA-RATE-003')).toEqual([]);
  });
});
