/** Test helpers for the ca-gst-hst pack. */
import type { ValidationReport } from '../../src/engine.ts';
import { validate } from '../../src/index.ts';
import type { InvoiceInput } from '../../src/model.ts';
import type { Issue } from '../../src/types.ts';

export function check(
  input: InvoiceInput | string,
  toleranceCents?: number,
  rateTransitionDays?: number,
): ValidationReport {
  return validate(input, {
    packs: ['ca-gst-hst'],
    ...(toleranceCents === undefined ? {} : { toleranceCents }),
    ...(rateTransitionDays === undefined ? {} : { rateTransitionDays }),
  });
}

export const all = (r: ValidationReport): Issue[] => [...r.errors, ...r.warnings, ...r.infos];

/** Rule IDs of errors and warnings (the findings that matter), sorted and de-duplicated. */
export const findings = (r: ValidationReport): string[] =>
  [...new Set([...r.errors, ...r.warnings].map((i) => i.ruleId))].sort();

/** Issues for one rule ID. */
export const byRule = (r: ValidationReport, ruleId: string): Issue[] =>
  all(r).filter((i) => i.ruleId === ruleId);

/** A complete tier-2 Ontario invoice ($250.00) that passes every rule. */
export const tier2: InvoiceInput = {
  invoiceNumber: 'T2',
  issueDate: '2026-04-02',
  supplier: { name: 'Supplier Inc.', gstHstNumber: '812345676RT0001', province: 'ON' },
  lines: [{ description: 'Printing', lineTotal: '221.24', taxStatus: 'taxable' }],
  taxes: [{ type: 'HST', rate: 13, taxableAmount: '221.24', amount: '28.76' }],
  subtotal: '221.24',
  total: '250.00',
};

/** A complete tier-3 Ontario invoice ($600.00) that passes every rule. */
export const tier3: InvoiceInput = {
  ...tier2,
  invoiceNumber: 'T3',
  buyer: { name: 'Buyer Ltd.' },
  paymentTerms: 'Net 30',
  lines: [{ description: 'Office chairs, 4 units', lineTotal: '530.97', taxStatus: 'taxable' }],
  taxes: [{ type: 'HST', rate: 13, taxableAmount: '530.97', amount: '69.03' }],
  subtotal: '530.97',
  total: '600.00',
};
