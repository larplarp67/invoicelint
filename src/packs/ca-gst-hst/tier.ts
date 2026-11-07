/**
 * ITC information tiers, SOR/91-45 s.3.
 *
 * The tier is based on "the total amount paid or payable shown on the
 * supporting documentation", taken as the total INCLUDING tax (maintainer
 * decision Q4, docs/decisions.md). Thresholds are in Canadian dollars.
 */
import type { Cents } from '../../money.ts';

export type Tier = 1 | 2 | 3;

/** s.3(b): "$100 or more and less than $500". */
export const TIER2_FROM_CENTS: Cents = 10_000;
/** s.3(c): "$500 or more". */
export const TIER3_FROM_CENTS: Cents = 50_000;

/**
 * The $100/$500 thresholds are deemed in force from this date
 * (S.C. 2024, c. 15, s. 142(4)). Before it they were $30/$150.
 */
export const THRESHOLDS_IN_FORCE_FROM = '2021-04-20';

export function computeTier(totalCents: Cents): Tier {
  if (totalCents >= TIER3_FROM_CENTS) return 3;
  if (totalCents >= TIER2_FROM_CENTS) return 2;
  return 1;
}

/** The paragraph of s.3 that sets each tier's requirements. */
export const TIER_PARAGRAPH: Record<Tier, string> = { 1: '(a)', 2: '(b)', 3: '(c)' };

/** What each tier needs, in plain words, for the tier message. */
export const TIER_NEEDS: Record<Tier, string> = {
  1: "the supplier's name, the date and the total",
  2: "the supplier's name, the date, the total, the supplier's GST/HST number and the GST/HST charged",
  3: "the supplier's name, the date, the total, the supplier's GST/HST number, the GST/HST charged, your business name, the payment terms and a description of each item",
};

export const TIER_RANGE: Record<Tier, string> = {
  1: 'under $100',
  2: 'between $100 and $499.99',
  3: '$500 or more',
};
