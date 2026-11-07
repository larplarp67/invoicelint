/**
 * Canonical invoice model. Every parser (JSON, UBL, ...) maps into this shape.
 *
 * Design notes (see docs/decisions.md):
 * - Money is accepted as a number or decimal string and stored as integer cents.
 * - Rates and quantities are stored as normalized decimal strings to stay exact.
 * - Fields the ITC rules check (supplier name, dates, BN, buyer, terms, ...) are
 *   optional here, so a missing field is reported by a rule with a citation
 *   rather than rejected as a parse error.
 * - Blank strings are treated as missing.
 * - Unknown properties are ignored (stripped), so producers can add extensions.
 */
import { z } from 'zod';
import { parseDecimal, parseMoney } from './money.ts';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Money: number or decimal string in input, integer cents in output. */
const money = (description: string) =>
  z
    .union([z.string(), z.number()])
    .transform((value, ctx) => {
      const result = parseMoney(value);
      if (!result.ok) {
        ctx.addIssue({ code: 'custom', message: result.reason, input: value });
        return z.NEVER;
      }
      return result.value;
    })
    .meta({
      description: `${description} Number or decimal string (e.g. 1234.56 or "1,234.56"); at most 2 decimal places.`,
    });

/** Exact decimal: number or decimal string in input, normalized decimal string in output. */
const decimal = (description: string, opts: Parameters<typeof parseDecimal>[1]) =>
  z
    .union([z.string(), z.number()])
    .transform((value, ctx) => {
      const result = parseDecimal(value, opts);
      if (!result.ok) {
        ctx.addIssue({ code: 'custom', message: result.reason, input: value });
        return z.NEVER;
      }
      return result.value;
    })
    .meta({ description });

/** Tax rate in percent: 13 means 13%, "9.975" means 9.975%. */
const ratePercent = (description: string) =>
  decimal(`${description} In percent: 13 means 13%. Up to 4 decimal places.`, {
    maxScale: 4,
    min: 0,
    max: 100,
  });

/** Free text; whitespace-only counts as missing. */
const text = (description: string) =>
  z
    .string()
    .trim()
    .transform((s) => (s === '' ? undefined : s))
    .meta({ description });

const isoDate = (description: string) =>
  z.iso.date().meta({ description: `${description} ISO 8601 calendar date (YYYY-MM-DD).` });

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const PROVINCES = [
  'AB',
  'BC',
  'MB',
  'NB',
  'NL',
  'NS',
  'NT',
  'NU',
  'ON',
  'PE',
  'QC',
  'SK',
  'YT',
] as const;
export const ProvinceSchema = z
  .enum(PROVINCES)
  .meta({ description: 'Canadian province or territory (two-letter postal code).' });

export const TAX_STATUSES = ['taxable', 'zero-rated', 'exempt'] as const;
export const TaxStatusSchema = z
  .enum(TAX_STATUSES)
  .meta({ description: 'GST/HST status of the supply.' });

export const TAX_TYPES = ['GST', 'HST', 'PST', 'QST', 'OTHER'] as const;
export const TaxTypeSchema = z.enum(TAX_TYPES).meta({
  description:
    'Kind of tax. OTHER = a tax invoicelint does not classify (for example foreign VAT); it counts in the totals but not in GST/HST checks.',
});

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

export const SupplierSchema = z
  .object({
    name: text('Supplier name or the name under which it does business.').optional(),
    gstHstNumber: text(
      'GST/HST registration number: 9-digit BN, or BN + "RT" + 4 digits (e.g. 123456789RT0001).',
    ).optional(),
    province: ProvinceSchema.optional(),
    address: text('Supplier address, free text.').optional(),
  })
  .meta({ description: 'The supplier (seller).' });

export const IntermediarySchema = z
  .object({
    name: text('Intermediary name or the name under which it does business.').optional(),
    gstHstNumber: text('Intermediary GST/HST registration number.').optional(),
  })
  .meta({
    description:
      "An intermediary in respect of the supply. SOR/91-45 s. 3 accepts the intermediary's name and registration number instead of the supplier's.",
  });

export const BuyerSchema = z
  .object({
    name: text(
      "Recipient's name, or its duly authorized agent's or representative's name.",
    ).optional(),
    tradingName: text('Name under which the recipient does business.').optional(),
  })
  .meta({ description: 'The recipient (buyer).' });

export const LineSchema = z
  .object({
    description: text('Description of the supply.').optional(),
    quantity: decimal('Quantity. Exact decimal, up to 6 decimal places.', {
      maxScale: 6,
    }).optional(),
    unitPrice: money('Price per unit.').optional(),
    lineTotal: money('Line amount.'),
    // Optional on purpose: SOR/91-45 s. 3(b)(v) asks whether the document
    // *states* each supply's status, so "not stated" must be representable.
    taxStatus: TaxStatusSchema.optional().meta({
      description:
        'GST/HST status as stated on the document. Omit when the document does not state it.',
    }),
  })
  .meta({ description: 'One supply (invoice line).' });

export const TaxSchema = z
  .object({
    type: TaxTypeSchema,
    rate: ratePercent('Tax rate.').optional(),
    taxableAmount: money('Amount the tax was computed on.').optional(),
    amount: money('Tax amount.'),
  })
  .meta({ description: 'A tax charged on the invoice.' });

export const TaxIncludedStatementSchema = z
  .object({
    included: z.literal(true).meta({ description: 'Always true when present.' }),
    rate: ratePercent('Stated total tax rate.').optional(),
  })
  .meta({
    description:
      'The document states that tax is included in the amounts (e.g. "total includes HST at 13%").',
  });

// ---------------------------------------------------------------------------
// Invoice
// ---------------------------------------------------------------------------

export const InvoiceSchema = z
  .object({
    invoiceNumber: text('Invoice number.').optional(),
    issueDate: isoDate('Invoice date.').optional(),
    taxPaidDate: isoDate(
      'Date tax was paid or became payable. Used when no invoice is issued (e.g. a receipt).',
    ).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, 'must be a 3-letter ISO 4217 currency code, e.g. "CAD"')
      .default('CAD')
      .meta({ description: 'ISO 4217 currency code.' }),
    supplier: SupplierSchema.default({}),
    intermediary: IntermediarySchema.optional(),
    buyer: BuyerSchema.optional(),
    lines: z.array(LineSchema).default([]).meta({ description: 'The supplies on the invoice.' }),
    taxes: z
      .array(TaxSchema)
      .default([])
      .meta({ description: 'Taxes charged, one entry per tax.' }),
    taxIncludedStatement: TaxIncludedStatementSchema.optional(),
    subtotal: money(
      'Sum of the line amounts, before document-level allowances, charges and tax.',
    ).optional(),
    allowanceTotal: money(
      'Document-level allowances (discounts) in total, as a positive amount. They reduce the amount tax is charged on.',
    ).optional(),
    chargeTotal: money(
      'Document-level charges (for example freight) in total, as a positive amount. They add to the amount tax is charged on.',
    ).optional(),
    total: money('Total amount paid or payable, including tax.'),
    paymentTerms: text('Terms of payment, e.g. "Net 30".').optional(),
  })
  .meta({
    title: 'invoicelint canonical invoice',
    description:
      'The invoice shape invoicelint validates. Amounts are numbers or decimal strings; dates are YYYY-MM-DD.',
  });

/** A parsed invoice: amounts in integer cents, rates/quantities as decimal strings. */
export type Invoice = z.output<typeof InvoiceSchema>;
/** What callers may pass in (amounts as numbers or strings). */
export type InvoiceInput = z.input<typeof InvoiceSchema>;
export type Supplier = Invoice['supplier'];
export type Intermediary = NonNullable<Invoice['intermediary']>;
export type Buyer = NonNullable<Invoice['buyer']>;
export type InvoiceLine = Invoice['lines'][number];
export type Tax = Invoice['taxes'][number];
export type TaxIncludedStatement = NonNullable<Invoice['taxIncludedStatement']>;
export type Province = z.output<typeof ProvinceSchema>;
export type TaxStatus = z.output<typeof TaxStatusSchema>;
export type TaxType = z.output<typeof TaxTypeSchema>;

export const INVOICE_SCHEMA_ID =
  'https://raw.githubusercontent.com/larplarp67/invoicelint/main/schema/invoice.schema.json';

/** JSON Schema (draft 2020-12) describing the accepted *input* shape. */
export function invoiceJsonSchema(): Record<string, unknown> {
  return { $id: INVOICE_SCHEMA_ID, ...z.toJSONSchema(InvoiceSchema, { io: 'input' }) };
}
