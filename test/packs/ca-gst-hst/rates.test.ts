import { describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE_OPTIONS } from '../../../src/engine.ts';
import { taxDate } from '../../../src/packs/ca-gst-hst/context.ts';
import { caGstHstPack } from '../../../src/packs/ca-gst-hst/index.ts';
import {
  COVERAGE_FROM,
  RATES_SOURCE,
  RATE_TABLE,
  changesNear,
  rateChanges,
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
    const ctx = caGstHstPack.createContext(tier2 as never, DEFAULT_ENGINE_OPTIONS);
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
  const rate002 = (inv: ReturnType<typeof hstInvoice>, days?: number) =>
    byRule(check(inv, undefined, days), 'CA-RATE-002');

  it('errors on HST 14% dated 2025-01-15: more than 60 days before Nova Scotia moved to 14%', () => {
    const report = check(hstInvoice(14, '2025-01-15'));
    expect(findings(report)).toEqual(['CA-RATE-002']);
    expect(report.ok).toBe(false);
    expect(byRule(report, 'CA-RATE-002')[0]).toMatchObject({
      severity: 'error',
      message:
        'HST is charged at 14%, but on 2025-01-15 no province had an HST rate of 14%. HST rates in force that day: 13% and 15%.',
    });
  });

  it('warns on HST 14% dated 2025-03-20: within 60 days of the change', () => {
    const report = check(hstInvoice(14, '2025-03-20'));
    expect(findings(report)).toEqual(['CA-RATE-002']);
    expect(report.ok).toBe(true); // a warning does not fail the report
    expect(byRule(report, 'CA-RATE-002')[0]).toMatchObject({
      severity: 'warning',
      message:
        'HST is charged at 14%, but on 2025-03-20 no province had an HST rate of 14%. HST rates in force that day: 13% and 15%. Nova Scotia changed from 15% to 14% on 2025-04-01. This invoice is near a rate change; confirm which rate applied.',
    });
    expect(byRule(report, 'CA-RATE-002')[0]?.fix).toMatch(/when the tax became payable/);
  });

  it('accepts HST 15% dated 2025-04-10: still the rate in NB, NL and PE', () => {
    expect(findings(check(hstInvoice(15, '2025-04-10')))).toEqual([]);
  });

  it('accepts HST 14% from 2025-04-01 (no finding at all)', () => {
    expect(findings(check(hstInvoice(14, '2025-04-01')))).toEqual([]);
    expect(findings(check(hstInvoice(14, '2025-04-15')))).toEqual([]);
  });

  it('window edges: 60 days before is a warning, 61 days before is an error', () => {
    expect(rate002(hstInvoice(14, '2025-01-31'))[0]?.severity).toBe('warning'); // 60 days
    expect(rate002(hstInvoice(14, '2025-01-30'))[0]?.severity).toBe('error'); // 61 days
    expect(rate002(hstInvoice(14, '2025-03-31'))[0]?.severity).toBe('warning'); // day before
  });

  it('the window is configurable', () => {
    expect(rate002(hstInvoice(14, '2025-03-20'), 0)[0]?.severity).toBe('error');
    expect(rate002(hstInvoice(14, '2025-01-15'), 90)[0]?.severity).toBe('warning');
  });

  it('a rate unrelated to any nearby change stays an error', () => {
    expect(rate002(hstInvoice(12, '2025-03-20'))[0]?.severity).toBe('error');
    expect(rate002(hstInvoice(12, '2026-01-10'))[0]?.severity).toBe('error');
  });

  it('uses the tax date: the earlier of the invoice date and the date paid', () => {
    // Paid (in advance) on 2025-01-10, invoiced 2025-04-15: tax date 2025-01-10.
    const report = check({ ...hstInvoice(14, '2025-04-15'), taxPaidDate: '2025-01-10' });
    expect(byRule(report, 'CA-RATE-002')[0]).toMatchObject({ severity: 'error' });
    expect(byRule(report, 'CA-RATE-002')[0]?.message).toContain('on 2025-01-10');
  });

  it('uses taxPaidDate when there is no invoice date', () => {
    const { issueDate: _drop, ...rest } = hstInvoice(14, '2025-01-15');
    expect(findings(check({ ...rest, taxPaidDate: '2025-01-15' }))).toEqual(['CA-RATE-002']);
  });

  it('errors on a rate no province ever had', () => {
    expect(findings(check(hstInvoice(12, '2026-01-10')))).toEqual(['CA-RATE-002']);
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

describe('tax date and rate changes', () => {
  it('names the payment date as such when it is the earlier date', () => {
    const report = check({
      issueDate: '2021-05-03',
      taxPaidDate: '2016-11-10',
      supplier: { name: 'S' },
      taxes: [{ type: 'HST', rate: 13, taxableAmount: '100.00', amount: '13.00' }],
      subtotal: '100.00',
      total: '113.00',
    });
    expect(byRule(report, 'CA-RATE-003')[0]?.message).toBe(
      'Skipped the GST/HST rate checks: the tax was paid on 2016-11-10, and invoicelint only has rates from 2017-01-01 onward.',
    );
    expect(byRule(report, 'CA-TIER-002')[0]?.message).toMatch(
      /^The tax was paid on 2016-11-10, before 20 April 2021\./,
    );
    expect(byRule(report, 'CA-TIER-002')[0]?.message).not.toContain('dated');
  });

  it.each([
    [{ issueDate: '2025-04-15', taxPaidDate: '2025-01-10' }, '2025-01-10', 'taxPaidDate'],
    [{ issueDate: '2025-01-10', taxPaidDate: '2025-04-15' }, '2025-01-10', 'issueDate'],
    [{ issueDate: '2025-01-10', taxPaidDate: '2025-01-10' }, '2025-01-10', 'issueDate'],
    [{ issueDate: '2025-01-10' }, '2025-01-10', 'issueDate'],
    [{ taxPaidDate: '2025-01-10' }, '2025-01-10', 'taxPaidDate'],
    [{}, undefined, 'issueDate'],
  ])('%j -> %s (%s)', (dates, date, field) => {
    expect(
      taxDate({ total: 0, currency: 'CAD', supplier: {}, lines: [], taxes: [], ...dates }),
    ).toEqual({
      date,
      dateField: field,
    });
  });

  it('finds the one real change in the table: Nova Scotia 15% -> 14% on 2025-04-01', () => {
    expect(rateChanges()).toEqual([
      { jurisdiction: 'NS', type: 'HST', from: '15', to: '14', effectiveFrom: '2025-04-01' },
    ]);
    expect(changesNear('2025-03-20', 'HST', 60)).toHaveLength(1);
    expect(changesNear('2025-03-20', 'GST', 60)).toEqual([]);
    expect(changesNear('2024-12-01', 'HST', 60)).toEqual([]);
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
