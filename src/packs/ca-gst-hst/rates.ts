/**
 * Dated GST/HST rate table.
 *
 * Source: Canada Revenue Agency, "GST/HST calculator (and rates)"
 *   https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate/calculator.html
 *   Retrieved 2026-11-07 (page "Date modified": 2025-04-01).
 *   Table: "GST/HST rates since April 1, 2013".
 *
 * Transcribed: the two periods that cover invoices from 2017-01-01 onward
 * ("October 1, 2016 to March 31, 2025" and "On or after April 1, 2025").
 * HST provinces are the ones whose PST is "N/A" in the page's current-rates
 * table (NB, NL, NS, ON, PE).
 *
 * Not transcribed: the 2013-04-01 to 2016-09-30 columns. Their New Brunswick
 * row shows 13% for July–September 2016, but CRA GST/HST Info Sheet GI-190
 * gives 15% from 2016-07-01. That period is outside the 2017+ coverage, so it
 * is left out rather than copied with a likely error (docs/decisions.md).
 *
 * Do not edit rates from memory: re-check the source page and update the
 * retrieval date.
 */
import type { Province } from '../../model.ts';

export const RATES_SOURCE = {
  title: 'GST/HST calculator (and rates)',
  url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate/calculator.html',
  table: 'GST/HST rates since April 1, 2013',
  retrieved: '2026-11-07',
  pageModified: '2025-04-01',
} as const;

/** Rate checks run for invoices dated on or after this date. */
export const COVERAGE_FROM = '2017-01-01';

export type RateType = 'GST' | 'HST';

export interface RateEntry {
  jurisdiction: Province;
  type: RateType;
  /** Combined rate in percent, as a normalized decimal string (HST includes the 5% federal part). */
  rate: string;
  /** First day the rate applies (inclusive, YYYY-MM-DD). */
  effectiveFrom: string;
  /** Last day the rate applies (inclusive). Omitted for the current rate. */
  effectiveTo?: string;
}

// Columns of the source table, oldest first.
const PERIODS = [
  { effectiveFrom: '2016-10-01', effectiveTo: '2025-03-31' },
  { effectiveFrom: '2025-04-01' },
] as const;

// Rows of the source table: [type, rate for each period above].
const SOURCE_ROWS: Record<Province, [RateType, string, string]> = {
  AB: ['GST', '5', '5'],
  BC: ['GST', '5', '5'],
  MB: ['GST', '5', '5'],
  NB: ['HST', '15', '15'],
  NL: ['HST', '15', '15'],
  NT: ['GST', '5', '5'],
  NS: ['HST', '15', '14'],
  NU: ['GST', '5', '5'],
  ON: ['HST', '13', '13'],
  QC: ['GST', '5', '5'],
  PE: ['HST', '15', '15'],
  SK: ['GST', '5', '5'],
  YT: ['GST', '5', '5'],
};

export const RATE_TABLE: readonly RateEntry[] = Object.entries(SOURCE_ROWS).flatMap(
  ([jurisdiction, [type, ...rates]]) =>
    PERIODS.map((period, i) => ({
      jurisdiction: jurisdiction as Province,
      type,
      rate: rates[i] ?? '',
      ...period,
    })),
);

/** True when the rate table covers this date. */
export function isCovered(date: string): boolean {
  return date >= COVERAGE_FROM;
}

/** Distinct valid rates of a type on a date, ascending: ratesOn('2025-03-15', 'HST') -> ["13", "15"]. */
export function ratesOn(date: string, type: RateType, table = RATE_TABLE): string[] {
  const rates = table
    .filter(
      (e) =>
        e.type === type &&
        e.effectiveFrom <= date &&
        (e.effectiveTo === undefined || date <= e.effectiveTo),
    )
    .map((e) => e.rate);
  return [...new Set(rates)].sort((a, b) => Number(a) - Number(b));
}

export const rates = { table: RATE_TABLE, source: RATES_SOURCE, isCovered, ratesOn } as const;
