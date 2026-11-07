/**
 * Tax math. Everything is integer cents; tax is recomputed with exact BigInt
 * math (money.ts) and compared within `toleranceCents` per tax line.
 * Rounding rule: docs/decisions.md ("Tax math rounding and tolerance").
 *
 * When a check lacks the fields it needs, it emits an "info" saying so
 * instead of guessing.
 */
import { defineRule } from '../../types.ts';
import { type CaContext, allLinesStatedNonTaxable, dollars, isGstHst } from '../context.ts';

const ARITHMETIC = 'Arithmetic consistency (no statutory provision)';

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

export const linesAddUp = defineRule<CaContext>(
  {
    id: 'CA-MATH-001',
    severity: 'error',
    title: 'Line amounts add up to the subtotal',
    citation: ARITHMETIC,
    fix: "Check the lines and the subtotal against the supplier's records and ask for a corrected invoice.",
  },
  ({ invoice }, report) => {
    const { lines, subtotal } = invoice;
    if (lines.length === 0 || subtotal === undefined) {
      report({
        field: lines.length === 0 ? 'lines' : 'subtotal',
        severity: 'info',
        message: `Skipped the line-total check: the invoice has no ${lines.length === 0 ? 'lines' : 'subtotal'}.`,
      });
      return;
    }
    // Exact: adding displayed amounts involves no rounding.
    const lineSum = sum(lines.map((l) => l.lineTotal));
    if (lineSum === subtotal) return;
    report({
      field: 'subtotal',
      message: `The line amounts add up to ${dollars(lineSum)}, but the subtotal says ${dollars(subtotal)} (a difference of ${dollars(Math.abs(subtotal - lineSum))}).`,
    });
  },
);

export const totalAddsUp = defineRule<CaContext>(
  {
    id: 'CA-MATH-002',
    severity: 'error',
    title: 'Subtotal plus taxes equals the total',
    citation: ARITHMETIC,
    fix: "Check the subtotal, taxes and total against the supplier's records and ask for a corrected invoice.",
  },
  ({ invoice, options }, report) => {
    if (invoice.taxIncludedStatement !== undefined) {
      report({
        field: 'total',
        severity: 'info',
        message:
          'Skipped the subtotal + tax = total check: the prices include tax, so the total is not subtotal plus tax.',
      });
      return;
    }
    const base =
      invoice.subtotal ??
      (invoice.lines.length > 0 ? sum(invoice.lines.map((l) => l.lineTotal)) : undefined);
    if (base === undefined) {
      report({
        field: 'subtotal',
        severity: 'info',
        message:
          'Skipped the subtotal + tax = total check: the invoice has no subtotal and no lines.',
      });
      return;
    }
    const baseLabel = invoice.subtotal === undefined ? 'The lines' : 'The subtotal';
    const taxSum = sum(invoice.taxes.map((t) => t.amount));
    const expected = base + taxSum;
    const diff = Math.abs(invoice.total - expected);
    if (diff <= options.toleranceCents * invoice.taxes.length) return;
    report({
      field: 'total',
      message: `${baseLabel} (${dollars(base)}) plus taxes (${dollars(taxSum)}) come to ${dollars(expected)}, but the total says ${dollars(invoice.total)} (a difference of ${dollars(diff)}).`,
    });
  },
);

export const taxAmountMatchesRate = defineRule<CaContext>(
  {
    id: 'CA-MATH-003',
    severity: 'error',
    title: 'Tax amount equals rate × taxable amount',
    citation: 'ETA s.165(1), (2)',
    fix: 'Recalculate the tax at the stated rate and ask the supplier for a corrected invoice if it differs.',
  },
  ({ invoice, options, money }, report) => {
    invoice.taxes.forEach((tax, i) => {
      if (tax.rate === undefined || tax.taxableAmount === undefined) {
        const missing =
          tax.rate === undefined && tax.taxableAmount === undefined
            ? 'rate or the amount it was charged on'
            : tax.rate === undefined
              ? 'rate'
              : 'amount it was charged on';
        report({
          field: `taxes[${i}]`,
          severity: 'info',
          message: `Skipped checking the ${tax.type} amount: the invoice doesn't show the ${missing}.`,
        });
        return;
      }
      const expected = money.percentOf(tax.taxableAmount, tax.rate);
      if (Math.abs(tax.amount - expected) <= options.toleranceCents) return;
      report({
        field: `taxes[${i}].amount`,
        message: `${tax.type} at ${tax.rate}% of ${dollars(tax.taxableAmount)} is ${dollars(expected)}, but the invoice shows ${dollars(tax.amount)}.`,
      });
    });
  },
);

export const taxOnNonTaxableSupplies = defineRule<CaContext>(
  {
    id: 'CA-MATH-004',
    severity: 'warning',
    title: 'GST/HST charged when every line is exempt or zero-rated',
    citation: 'ETA s.165(1), (3)',
    fix: 'Ask the supplier which is right: the GST/HST charged or the line statuses.',
  },
  ({ invoice }, report) => {
    if (!allLinesStatedNonTaxable(invoice)) return;
    if (!invoice.taxes.some((t) => isGstHst(t) && t.amount > 0)) return;
    report({
      field: 'taxes',
      message:
        'GST/HST is charged, but every line is marked exempt or zero-rated, and those supplies carry no GST/HST. Either a line status or the tax is wrong.',
    });
  },
);

export const mathRules = [linesAddUp, totalAddsUp, taxAmountMatchesRate, taxOnNonTaxableSupplies];
