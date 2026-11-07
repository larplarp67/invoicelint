/** The context every ca-gst-hst rule receives. */
import type { Invoice } from '../../model.ts';
import { type Cents, formatMoney, multiplyCents, percentOf } from '../../money.ts';
import type { EngineOptions, RuleContext } from '../types.ts';
import { rates } from './rates.ts';
import { type Tier, computeTier } from './tier.ts';

/** Format cents for messages: 123456 -> "$1,234.56", -500 -> "-$5.00". */
export function dollars(cents: Cents): string {
  return cents < 0 ? `-$${formatMoney(-cents)}` : `$${formatMoney(cents)}`;
}

/**
 * Format an invoice amount in its own currency: CAD -> "$1,234.56",
 * others -> "1,234.56 SEK". (Tier thresholds are always CAD and use "$".)
 */
export function formatAmount(cents: Cents, currency: string): string {
  if (currency === 'CAD') return dollars(cents);
  return `${cents < 0 ? '-' : ''}${formatMoney(Math.abs(cents))} ${currency}`;
}

export const money = { dollars, formatMoney, multiplyCents, percentOf } as const;

export type MoneyHelpers = typeof money & {
  /** Format an amount in the invoice's currency. */
  amount: (cents: Cents) => string;
};

export interface CaContext extends RuleContext {
  tier: Tier;
  /**
   * Tax date for date-dependent checks: the earlier of the invoice date and
   * the date tax was paid (ETA s.168(1)). See taxDate().
   */
  date: string | undefined;
  /** Name of the field `date` came from, for issue paths. */
  dateField: 'issueDate' | 'taxPaidDate';
  money: MoneyHelpers;
  /** Dated GST/HST rate table and lookups. */
  rates: typeof rates;
}

/**
 * The tax date: the earlier of the invoice date and the date tax was paid.
 * ETA s.168(1): tax is payable on the earlier of the day the consideration is
 * paid and the day it becomes due (usually the invoice date).
 */
export function taxDate(invoice: Invoice): Pick<CaContext, 'date' | 'dateField'> {
  const { issueDate, taxPaidDate } = invoice;
  if (issueDate !== undefined && (taxPaidDate === undefined || issueDate <= taxPaidDate)) {
    return { date: issueDate, dateField: 'issueDate' };
  }
  if (taxPaidDate !== undefined) return { date: taxPaidDate, dateField: 'taxPaidDate' };
  return { date: undefined, dateField: 'issueDate' };
}

export function createCaContext(invoice: Invoice, options: EngineOptions): CaContext {
  return {
    invoice,
    options,
    tier: computeTier(invoice.total),
    ...taxDate(invoice),
    money: { ...money, amount: (cents) => formatAmount(cents, invoice.currency) },
    rates,
  };
}

// ---------------------------------------------------------------------------
// Small predicates shared by rules
// ---------------------------------------------------------------------------

type Line = Invoice['lines'][number];
type TaxLine = Invoice['taxes'][number];

export const isGstHst = (t: TaxLine): boolean => t.type === 'GST' || t.type === 'HST';

/** How a tax line is named in messages: "GST", "HST", "PST", "QST", or "Tax" for OTHER. */
export const taxLabel = (t: TaxLine): string => (t.type === 'OTHER' ? 'Tax' : t.type);

/** Stated as exempt or zero-rated: a supply that carries no GST/HST. */
export const isStatedNonTaxable = (l: Line): boolean =>
  l.taxStatus === 'exempt' || l.taxStatus === 'zero-rated';

/** True when the invoice has lines and every one is stated exempt or zero-rated. */
export function allLinesStatedNonTaxable(invoice: Invoice): boolean {
  return invoice.lines.length > 0 && invoice.lines.every(isStatedNonTaxable);
}
