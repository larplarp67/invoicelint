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
 * row shows 13% for July–September 2016, but CRA Excise and GST/HST News
 * No. 99 gives 15% "effective July 1, 2016". That period is outside the 2017+ coverage, so it
 * is left out rather than copied with a likely error (docs/decisions.md).
 *
 * Do not edit rates from memory: re-check the source page and update the
 * retrieval date.
 */
import type { Province } from '../../model.ts';

/** Where the rate table was transcribed from, and when. */
export const RATES_SOURCE = {
  title: 'GST/HST calculator (and rates)',
  url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate/calculator.html',
  table: 'GST/HST rates since April 1, 2013',
  retrieved: '2026-11-07',
  pageModified: '2025-04-01',
} as const;

/** Rate checks run for invoices dated on or after this date. */
export const COVERAGE_FROM = '2017-01-01';

/** GST (federal) or HST (harmonized, participating provinces). */
export type RateType = 'GST' | 'HST';

/** One rate for one province or territory over a period. */
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

/** The dated GST/HST rate table, one entry per province per period. */
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

const inForce = (e: RateEntry, date: string): boolean =>
  e.effectiveFrom <= date && (e.effectiveTo === undefined || date <= e.effectiveTo);

/** Distinct valid rates of a type on a date, ascending: ratesOn('2025-03-15', 'HST') -> ["13", "15"]. */
export function ratesOn(date: string, type: RateType, table = RATE_TABLE): string[] {
  const rates = table.filter((e) => e.type === type && inForce(e, date)).map((e) => e.rate);
  return [...new Set(rates)].sort((a, b) => Number(a) - Number(b));
}

/**
 * A province's or territory's own rate on a date: GST in a GST-only province,
 * HST (combined) in a participating one. rateIn('NS', '2026-01-01') -> HST 14%.
 */
export function rateIn(
  jurisdiction: Province,
  date: string,
  table = RATE_TABLE,
): RateEntry | undefined {
  return table.find((e) => e.jurisdiction === jurisdiction && inForce(e, date));
}

/** Provinces and territories whose rate on a date was `rate` of `type`, in table order. */
export function jurisdictionsWith(
  date: string,
  type: RateType,
  rate: string,
  table = RATE_TABLE,
): Province[] {
  return table
    .filter((e) => e.type === type && e.rate === rate && inForce(e, date))
    .map((e) => e.jurisdiction);
}

/** A change of rate in one province: `from` until the day before `effectiveFrom`, then `to`. */
export interface RateChange {
  jurisdiction: Province;
  type: RateType;
  from: string;
  to: string;
  effectiveFrom: string;
}

/** Every rate change in the table (consecutive periods of a province with different rates). */
export function rateChanges(table = RATE_TABLE): RateChange[] {
  const changes: RateChange[] = [];
  const byKey = new Map<string, RateEntry[]>();
  for (const e of table) {
    const key = `${e.jurisdiction}/${e.type}`;
    byKey.set(key, [...(byKey.get(key) ?? []), e]);
  }
  for (const entries of byKey.values()) {
    const sorted = [...entries].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const next = sorted[i];
      if (prev && next && prev.rate !== next.rate) {
        changes.push({
          jurisdiction: next.jurisdiction,
          type: next.type,
          from: prev.rate,
          to: next.rate,
          effectiveFrom: next.effectiveFrom,
        });
      }
    }
  }
  return changes;
}

const RATE_CHANGES = rateChanges();

const dayNumber = (isoDate: string): number => {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) / 86_400_000;
};

/** Rate changes of a type whose effective date is within `windowDays` of `date`. */
export function changesNear(date: string, type: RateType, windowDays: number): RateChange[] {
  const day = dayNumber(date);
  return RATE_CHANGES.filter(
    (c) => c.type === type && Math.abs(dayNumber(c.effectiveFrom) - day) <= windowDays,
  );
}

export const PROVINCE_NAMES: Record<Province, string> = {
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon',
};

export const rates = {
  table: RATE_TABLE,
  source: RATES_SOURCE,
  isCovered,
  ratesOn,
  rateIn,
  jurisdictionsWith,
  changesNear,
} as const;
