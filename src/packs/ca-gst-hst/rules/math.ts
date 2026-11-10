/**
 * Tax math. Everything is integer cents; tax is recomputed with exact BigInt
 * math (money.ts) and compared within `toleranceCents` per tax line.
 * Rounding rule: docs/decisions.md ("Tax math rounding and tolerance").
 *
 * When a check lacks the fields it needs, it emits an "info" saying so
 * instead of guessing.
 */
import { defineRule } from '../../types.ts';
import {
  type CaContext,
  allLinesStatedNonTaxable,
  isGstHst,
  isStatedNonTaxable,
  taxLabel,
} from '../context.ts';

const ARITHMETIC = 'Arithmetic check (not a legal requirement)';

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

export const linesAddUp = defineRule<CaContext>(
  {
    id: 'CA-MATH-001',
    severity: 'error',
    title: 'Line amounts add up to the subtotal',
    citation: ARITHMETIC,
    fix: "Check the lines and the subtotal against the supplier's records and ask for a corrected invoice.",
  },
  ({ invoice, money }, report) => {
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
      message: `The line amounts add up to ${money.amount(lineSum)}, but the subtotal says ${money.amount(subtotal)} (a difference of ${money.amount(Math.abs(subtotal - lineSum))}).`,
    });
  },
);

export const totalAddsUp = defineRule<CaContext>(
  {
    id: 'CA-MATH-002',
    severity: 'error',
    title: 'Subtotal, less allowances, plus charges and taxes, equals the total',
    citation: ARITHMETIC,
    fix: "Check the subtotal, taxes and total against the supplier's records and ask for a corrected invoice.",
  },
  ({ invoice, options, money }, report) => {
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
    const allowances = invoice.allowanceTotal ?? 0;
    const charges = invoice.chargeTotal ?? 0;
    const expected = base - allowances + charges + taxSum;
    const adjustments =
      (invoice.allowanceTotal === undefined
        ? ''
        : ` minus allowances (${money.amount(allowances)})`) +
      (invoice.chargeTotal === undefined ? '' : ` plus charges (${money.amount(charges)})`);
    const diff = Math.abs(invoice.total - expected);
    if (diff <= options.toleranceCents * invoice.taxes.length) return;
    report({
      field: 'total',
      message: `${baseLabel} (${money.amount(base)})${adjustments} plus taxes (${money.amount(taxSum)}) come to ${money.amount(expected)}, but the total says ${money.amount(invoice.total)} (a difference of ${money.amount(diff)}).`,
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
          message: `Skipped checking the ${taxLabel(tax)} amount: the invoice doesn't show the ${missing}.`,
        });
        return;
      }
      const expected = money.percentOf(tax.taxableAmount, tax.rate);
      if (Math.abs(tax.amount - expected) <= options.toleranceCents) return;
      report({
        field: `taxes[${i}].amount`,
        message: `${taxLabel(tax)} at ${tax.rate}% of ${money.amount(tax.taxableAmount)} is ${money.amount(expected)}, but the invoice shows ${money.amount(tax.amount)}.`,
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
        'GST/HST is charged, but every line is marked exempt or zero-rated, and those items carry no GST/HST. Either a line status or the tax is wrong.',
    });
  },
);

/** "a", "a and b", "a, b, and c" */
const joinList = (items: readonly string[]): string =>
  items.length <= 2
    ? items.join(' and ')
    : `${items.slice(0, -1).join(', ')}, and ${items.at(-1) ?? ''}`;

/** True when `amount` is further from zero than `bound` in its own direction (refunds are negative). */
const exceeds = (amount: number, bound: number): boolean =>
  amount < 0 && bound <= 0 ? amount < bound : amount > bound;

export const taxOnNonTaxableLines = defineRule<CaContext>(
  {
    id: 'CA-MATH-005',
    severity: 'warning',
    title: 'GST/HST charged on more than the lines not marked exempt or zero-rated',
    citation: 'ETA s.165(1), (2), (3)',
    fix: 'Ask the supplier which is right: the amount GST/HST was charged on, or the exempt and zero-rated line statuses.',
  },
  ({ invoice, money }, report) => {
    const { lines } = invoice;
    // Only a line marked exempt or zero-rated can be taxed by mistake. When
    // every line is, CA-MATH-004 reports it instead.
    if (!lines.some(isStatedNonTaxable) || allLinesStatedNonTaxable(invoice)) return;

    // The most GST/HST can be charged on: every line not marked exempt or
    // zero-rated (unmarked lines may be taxable; CA-ITC-013 asks for the
    // marking), plus document-level charges. Allowances are left out so this
    // stays an upper bound. Exact, like CA-MATH-001: no rounding is involved.
    const lineSum = sum(lines.filter((l) => !isStatedNonTaxable(l)).map((l) => l.lineTotal));
    const charges = invoice.chargeTotal ?? 0;
    const bound = lineSum + charges;
    const marked = lines.flatMap((l, i) =>
      isStatedNonTaxable(l)
        ? [
            `line ${i + 1}${l.description === undefined ? '' : ` ("${l.description}")`} is marked ${l.taxStatus ?? ''}`,
          ]
        : [],
    );
    const boundText =
      invoice.chargeTotal === undefined
        ? `the lines not marked exempt or zero-rated add up to ${money.amount(bound)}`
        : `the lines not marked exempt or zero-rated (${money.amount(lineSum)}) plus charges (${money.amount(charges)}) come to ${money.amount(bound)}`;

    invoice.taxes.forEach((tax, i) => {
      if (!isGstHst(tax) || tax.taxableAmount === undefined) return;
      if (!exceeds(tax.taxableAmount, bound)) return;
      report({
        field: `taxes[${i}].taxableAmount`,
        message: `${taxLabel(tax)} is charged on ${money.amount(tax.taxableAmount)}, but ${boundText}: ${joinList(marked)}. Exempt and zero-rated items carry no GST/HST, so either a line status or the amount taxed is wrong.`,
      });
    });
  },
);

export const mathRules = [
  linesAddUp,
  totalAddsUp,
  taxAmountMatchesRate,
  taxOnNonTaxableSupplies,
  taxOnNonTaxableLines,
];
