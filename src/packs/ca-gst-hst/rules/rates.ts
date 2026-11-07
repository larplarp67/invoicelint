/**
 * GST/HST rate checks against the dated rate table (rates.ts).
 *
 * Place of supply is not determined yet, so an HST rate is accepted if ANY
 * province had it on the invoice date. PST and QST rates are not checked
 * (they don't affect ITCs); their amounts still count in the total math.
 */
import { defineRule } from '../../types.ts';
import { type CaContext, isGstHst } from '../context.ts';
import { COVERAGE_FROM } from '../rates.ts';

const percentList = (rates: readonly string[]): string =>
  rates.map((r) => `${r}%`).join(rates.length === 2 ? ' and ' : ', ');

export const gstRate = defineRule<CaContext>(
  {
    id: 'CA-RATE-001',
    severity: 'error',
    title: 'GST rate is the rate in force (5%)',
    citation: 'ETA s.165(1)',
    fix: 'Check the GST rate (5%) and ask the supplier for a corrected invoice.',
  },
  ({ invoice, date, rates }, report) => {
    if (date === undefined || !rates.isCovered(date)) return;
    const valid = rates.ratesOn(date, 'GST');
    invoice.taxes.forEach((tax, i) => {
      if (tax.type !== 'GST' || tax.rate === undefined || valid.includes(tax.rate)) return;
      report({
        field: `taxes[${i}].rate`,
        message: `GST is charged at ${tax.rate}%, but the GST rate on ${date} was ${percentList(valid)}.`,
      });
    });
  },
);

export const hstRate = defineRule<CaContext>(
  {
    id: 'CA-RATE-002',
    severity: 'error',
    title: 'HST rate was in force in some province on the invoice date',
    citation: 'ETA s.165(2)',
    fix: 'Check the HST rate for the province where the supply was made, and ask the supplier for a corrected invoice.',
  },
  ({ invoice, date, rates }, report) => {
    if (date === undefined || !rates.isCovered(date)) return;
    const valid = rates.ratesOn(date, 'HST');
    invoice.taxes.forEach((tax, i) => {
      if (tax.type !== 'HST' || tax.rate === undefined || valid.includes(tax.rate)) return;
      report({
        field: `taxes[${i}].rate`,
        message: `HST is charged at ${tax.rate}%, but on ${date} no province had an HST rate of ${tax.rate}%. HST rates in force that day: ${percentList(valid)}.`,
      });
    });
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
        message: `Skipped the GST/HST rate checks: the invoice is dated ${date}, before ${COVERAGE_FROM}, which is earlier than the rate table covers.`,
      });
    }
  },
);

export const rateRules = [gstRate, hstRate, rateChecksSkipped];
