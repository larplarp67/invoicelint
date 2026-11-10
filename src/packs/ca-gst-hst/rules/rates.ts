/**
 * GST/HST rate checks against the dated rate table (rates.ts).
 *
 * - The rate is checked on the tax date (earlier of invoice date and date paid).
 * - Place of supply is not determined, so CA-RATE-001/002 accept an HST rate
 *   if ANY province had it on that date. When the supplier's province is
 *   known and the rate isn't that province's, CA-RATE-004 warns to confirm
 *   place of supply: the supply can be made in another province. CA-RATE-004
 *   also checks the rate of a tax-included statement; CA-RATE-001/002 don't,
 *   since that rate has no tax type and may include PST or QST.
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

/** "A", "A and B", "A, B, and C" (the comma keeps "Newfoundland and Labrador" readable). */
const nameList = (names: readonly string[]): string =>
  names.length <= 2
    ? names.join(' and ')
    : `${names.slice(0, -1).join(', ')}, and ${names.at(-1) ?? ''}`;

export const provinceRate = defineRule<CaContext>(
  {
    id: 'CA-RATE-004',
    severity: 'warning',
    title:
      "GST/HST rate (or tax-included rate) is the supplier's province's rate on the tax date (if not, confirm place of supply)",
    citation: 'ETA s.144.1, s.165(2), Sch. IX',
    fix: "Find out where the supply was made under the place-of-supply rules (CRA GST/HST Memorandum 3-3-2); it can be the buyer's province rather than the supplier's. If it was made in the supplier's province, ask the supplier for a corrected invoice at that province's rate.",
  },
  ({ invoice, date, rates, options }, report) => {
    const province = invoice.supplier.province;
    if (province === undefined || date === undefined || !rates.isCovered(date)) return;
    const home = rates.rateIn(province, date);
    if (home === undefined) return;
    const provinceName = PROVINCE_NAMES[province];
    // Near a change in the supplier's own province, its old and new rates are
    // both accepted, as for CA-RATE-001/002 (transition window).
    const nearby = rates
      .changesNear(date, home.type, options.rateTransitionDays)
      .filter((c) => c.jurisdiction === province)
      .flatMap((c) => [c.from, c.to]);
    const isHome = (type: RateType, rate: string) =>
      type === home.type && (rate === home.rate || nearby.includes(rate));
    const homeText =
      home.type === 'HST'
        ? `where the HST rate on ${date} was ${home.rate}%`
        : `where only GST (${home.rate}%) applied on ${date}`;

    /** Report a rate that was in force elsewhere (`places`) but isn't the province's own. */
    const confirm = (field: string, type: RateType, rate: string, statement: boolean) => {
      const places = rates.jurisdictionsWith(date, type, rate);
      const charged = statement
        ? `the invoice says tax is included at ${rate}%`
        : `${type} is charged at ${rate}%`;
      const lead =
        type === 'HST'
          ? `${rate}% was the HST rate in ${nameList(places.map((p) => PROVINCE_NAMES[p]))}, so it is`
          : statement
            ? `${rate}% is GST alone, which is`
            : 'GST alone is';
      const where =
        type === 'HST'
          ? `right only if the supply was made ${places.length === 1 ? 'there' : 'in one of those provinces'}`
          : 'right only if the supply was made in a province or territory without HST';
      report({
        field,
        message: `The supplier is in ${provinceName}, ${homeText}, but ${charged}. ${lead} ${where}; confirm place of supply.`,
      });
    };

    invoice.taxes.forEach((tax, i) => {
      const { type, rate } = tax;
      if ((type !== 'GST' && type !== 'HST') || rate === undefined) return;
      if (isHome(type, rate)) return;
      // A rate in force nowhere that day is CA-RATE-001/002's finding, not this one.
      if (rates.jurisdictionsWith(date, type, rate).length === 0) return;
      confirm(`taxes[${i}].rate`, type, rate, false);
    });

    // "Tax included at X%" (SOR/91-45 s.3(b)(iv)(B)) has no tax type: 5% is
    // GST alone, 13% to 15% HST. In GST-only provinces the stated rate often
    // includes PST or QST (BC 12%, Quebec 14.975%), so a rate that is no GST or
    // HST rate is noted as unchecked rather than warned about.
    const stated = invoice.taxIncludedStatement?.rate;
    if (stated === undefined || isHome(home.type, stated)) return;
    const field = 'taxIncludedStatement.rate';
    const type = (['GST', 'HST'] as const).find(
      (t) => rates.jurisdictionsWith(date, t, stated).length > 0,
    );
    if (type === undefined) {
      report({
        field,
        severity: 'info',
        message: `Didn't compare the tax-included rate of ${stated}% with ${provinceName}'s rate: ${stated}% wasn't a GST or HST rate on ${date}, so it may include provincial sales tax.`,
        fix: 'No action needed if the rate includes provincial sales tax. Otherwise check the rate by hand.',
      });
      return;
    }
    confirm(field, type, stated, true);
  },
);

export const rateRules = [gstRate, hstRate, rateChecksSkipped, provinceRate];
