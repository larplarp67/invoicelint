/**
 * GST/HST rate checks against the dated rate table (rates.ts).
 *
 * - The rate is checked on the tax date (earlier of invoice date and date paid).
 * - Place of supply is not determined yet, so an HST rate is accepted if ANY
 *   province had it on that date.
 * - Near a rate change (within `rateTransitionDays`, default 60, of its
 *   effective date) the old and new rates of that change are accepted with a
 *   WARNING: transitional rules depend on when consideration was paid or became
 *   due, which an invoice doesn't always show. This is a simplification of the
 *   transitional rules, not an implementation of them (docs/decisions.md).
 * - PST and QST rates are not checked (they don't affect ITCs); their amounts
 *   still count in the total math.
 */
import type { Invoice } from '../../../model.ts';
import { type IssueDraft, defineRule } from '../../types.ts';
import { type CaContext, describeTaxDate, isGstHst } from '../context.ts';
import { COVERAGE_FROM, PROVINCE_NAMES, type RateChange, type RateType } from '../rates.ts';

const percentList = (rates: readonly string[]): string =>
  rates.map((r) => `${r}%`).join(rates.length === 2 ? ' and ' : ', ');

const NEAR_CHANGE_FIX =
  'Check which rate applied: it depends on when the tax became payable (the earlier of when the invoice was due and when it was paid). Ask the supplier if unsure.';

const describeChanges = (changes: readonly RateChange[]): string =>
  changes
    .map(
      (c) =>
        `${PROVINCE_NAMES[c.jurisdiction]} changed from ${c.from}% to ${c.to}% on ${c.effectiveFrom}`,
    )
    .join('; ');

/** Shared check: report each tax line of `type` whose rate wasn't in force on the tax date. */
function checkRates(
  type: RateType,
  { invoice, date, rates, options }: CaContext,
  report: (draft: IssueDraft) => void,
  notInForce: (rate: string, date: string, valid: readonly string[]) => string,
): void {
  if (date === undefined || !rates.isCovered(date)) return;
  const valid = rates.ratesOn(date, type);
  invoice.taxes.forEach((tax: Invoice['taxes'][number], i) => {
    if (tax.type !== type || tax.rate === undefined || valid.includes(tax.rate)) return;
    const rate = tax.rate;
    const near = rates
      .changesNear(date, type, options.rateTransitionDays)
      .filter((c) => c.from === rate || c.to === rate);
    if (near.length > 0) {
      report({
        field: `taxes[${i}].rate`,
        severity: 'warning',
        message: `${notInForce(rate, date, valid)} ${describeChanges(near)}. This invoice is near a rate change; confirm which rate applied.`,
        fix: NEAR_CHANGE_FIX,
      });
    } else {
      report({ field: `taxes[${i}].rate`, message: notInForce(rate, date, valid) });
    }
  });
}

export const gstRate = defineRule<CaContext>(
  {
    id: 'CA-RATE-001',
    severity: 'error',
    title: 'GST rate is the rate in force (5%) on the tax date',
    citation: 'ETA s.165(1)',
    fix: 'Check the GST rate (5%) and ask the supplier for a corrected invoice.',
  },
  (ctx, report) => {
    checkRates(
      'GST',
      ctx,
      report,
      (rate, date, valid) =>
        `GST is charged at ${rate}%, but the GST rate on ${date} was ${percentList(valid)}.`,
    );
  },
);

export const hstRate = defineRule<CaContext>(
  {
    id: 'CA-RATE-002',
    severity: 'error',
    title: 'HST rate was in force in some province on the tax date (warning near a rate change)',
    citation: 'ETA s.165(2)',
    fix: 'Check the HST rate for the province where the supply was made, and ask the supplier for a corrected invoice.',
  },
  (ctx, report) => {
    checkRates(
      'HST',
      ctx,
      report,
      (rate, date, valid) =>
        `HST is charged at ${rate}%, but on ${date} no province had an HST rate of ${rate}%. HST rates in force that day: ${percentList(valid)}.`,
    );
  },
);

export const rateChecksSkipped = defineRule<CaContext>(
  {
    id: 'CA-RATE-003',
    severity: 'info',
    title: 'GST/HST rate checks skipped (no date, or before 2017)',
    citation: 'ETA s.165(1), (2)',
    fix: 'No action needed. Check the rate by hand if it matters for this invoice.',
  },
  ({ invoice, date, dateField, rates }, report) => {
    if (!invoice.taxes.some((t) => isGstHst(t) && t.rate !== undefined)) return;
    if (date === undefined) {
      report({
        field: 'issueDate',
        message:
          "Skipped the GST/HST rate checks: the invoice has no date, so the rate in force can't be determined.",
      });
    } else if (!rates.isCovered(date)) {
      report({
        field: dateField,
        message: `Skipped the GST/HST rate checks: ${describeTaxDate({ date, dateField })}, and invoicelint only has rates from ${COVERAGE_FROM} onward.`,
      });
    }
  },
);

export const rateRules = [gstRate, hstRate, rateChecksSkipped];
