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
   * Date used for date-dependent checks: the invoice date, or the date tax was
   * paid or payable when there is no invoice date.
   */
  date: string | undefined;
  /** Name of the field `date` came from, for issue paths. */
  dateField: 'issueDate' | 'taxPaidDate';
  money: MoneyHelpers;
  /** Dated GST/HST rate table and lookups. */
  rates: typeof rates;
}

export function createCaContext(invoice: Invoice, options: EngineOptions): CaContext {
  return {
    invoice,
    options,
    tier: computeTier(invoice.total),
    date: invoice.issueDate ?? invoice.taxPaidDate,
    dateField:
      invoice.issueDate === undefined && invoice.taxPaidDate !== undefined
        ? 'taxPaidDate'
        : 'issueDate',
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
