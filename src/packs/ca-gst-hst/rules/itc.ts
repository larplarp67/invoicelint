/**
 * Input tax credit information rules, SOR/91-45 s.3.
 *
 * Every rule here is a "warning": the law lets the information come from other
 * documents (s.2, "supporting documentation"), so a gap on this document is
 * never "illegal". Messages say what this document alone is missing.
 */
import { defineRule } from '../../types.ts';
import {
  type CaContext,
  allLinesStatedNonTaxable,
  dollars,
  isGstHst,
  isStatedNonTaxable,
} from '../context.ts';

// ---------------------------------------------------------------------------
// Tier 1+: s.3(a)
// ---------------------------------------------------------------------------

export const supplierName = defineRule<CaContext>(
  {
    id: 'CA-ITC-001',
    severity: 'warning',
    title: 'Supplier or intermediary name',
    citation: 'SOR/91-45 s.3(a)(i)',
    appliesFromTier: 1,
    fix: "Get a document that shows the supplier's name (or the name it does business under) and keep it with this one.",
  },
  ({ invoice }, report) => {
    if (invoice.supplier.name !== undefined || invoice.intermediary?.name !== undefined) return;
    report({
      field: 'supplier.name',
      message:
        "This document alone doesn't show the supplier's name (or an intermediary's). An input tax credit claim needs the name of the supplier or the name it does business under.",
    });
  },
);

export const invoiceDate = defineRule<CaContext>(
  {
    id: 'CA-ITC-002',
    severity: 'warning',
    title: 'Invoice date (or date tax was paid)',
    citation: 'SOR/91-45 s.3(a)(ii), (iii)',
    appliesFromTier: 1,
    fix: 'Record the invoice date, or for a receipt the date it was paid, with this document.',
  },
  ({ invoice }, report) => {
    if (invoice.issueDate !== undefined || invoice.taxPaidDate !== undefined) return;
    report({
      field: 'issueDate',
      message:
        "This document alone doesn't show a date. An input tax credit claim needs the invoice date, or, when there is no invoice, the date the tax was paid or became payable.",
    });
  },
);

// ---------------------------------------------------------------------------
// Tier 2+: s.3(b)
// ---------------------------------------------------------------------------

export const registrationNumber = defineRule<CaContext>(
  {
    id: 'CA-ITC-010',
    severity: 'warning',
    title: 'GST/HST registration number of the party named',
    citation: 'SOR/91-45 s.3(b)(i)',
    appliesFromTier: 2,
    fix: 'Ask the supplier for its GST/HST number (9 digits, then RT and 4 digits, e.g. 123456789 RT 0001) and keep it with this invoice.',
  },
  ({ invoice }, report) => {
    // s.3(b)(i): the name of the supplier OR the intermediary, and the number
    // of "the supplier or the intermediary, as the case may be". Any named
    // party showing its own number satisfies it.
    const parties = [
      { key: 'supplier', party: invoice.supplier },
      ...(invoice.intermediary ? [{ key: 'intermediary', party: invoice.intermediary }] : []),
    ];
    const named = parties.filter((p) => p.party.name !== undefined);
    const candidates = named.length > 0 ? named : parties;
    if (candidates.some((p) => p.party.gstHstNumber !== undefined)) return;

    const onlyIntermediaryNamed = named.length === 1 && named[0]?.key === 'intermediary';
    report({
      field: onlyIntermediaryNamed ? 'intermediary.gstHstNumber' : 'supplier.gstHstNumber',
      message: `This invoice totals ${dollars(invoice.total)} including tax. Invoices of $100 or more need the GST/HST registration number of the ${onlyIntermediaryNamed ? 'intermediary' : 'supplier'} named on it to support an input tax credit, and this document alone doesn't show one.`,
    });
  },
);

export const taxDisclosure = defineRule<CaContext>(
  {
    id: 'CA-ITC-011',
    severity: 'warning',
    title: 'GST/HST charged, or a tax-included statement',
    citation: 'SOR/91-45 s.3(b)(iii), (iv)',
    appliesFromTier: 2,
    fix: 'Ask the supplier for an invoice that shows the GST/HST amount, or states that tax is included and at what rate.',
  },
  ({ invoice }, report) => {
    // No ITC is possible when every supply is exempt or zero-rated.
    if (allLinesStatedNonTaxable(invoice)) return;
    if (invoice.taxes.some(isGstHst) || invoice.taxIncludedStatement !== undefined) return;
    report({
      field: 'taxes',
      message:
        "This document alone doesn't show the GST/HST charged. For invoices of $100 or more, an input tax credit claim needs either the GST/HST amount, or a statement that the price includes GST/HST together with the total tax rate.",
    });
  },
);

export const taxIncludedRate = defineRule<CaContext>(
  {
    id: 'CA-ITC-012',
    severity: 'warning',
    title: 'Total tax rate on a tax-included invoice',
    citation: 'SOR/91-45 s.3(b)(iv)(B)',
    appliesFromTier: 2,
    fix: 'Ask the supplier for an invoice that states the GST/HST rate included in the price (for example "HST 13% included").',
  },
  ({ invoice }, report) => {
    const statement = invoice.taxIncludedStatement;
    if (statement === undefined || statement.rate !== undefined) return;
    if (allLinesStatedNonTaxable(invoice)) return;
    report({
      field: 'taxIncludedStatement.rate',
      message:
        "The invoice says tax is included in the price but doesn't state the total tax rate (for example 13%). For invoices of $100 or more, a tax-included invoice must show that rate to support an input tax credit.",
    });
  },
);

export const statusIndication = defineRule<CaContext>(
  {
    id: 'CA-ITC-013',
    severity: 'warning',
    title: 'Status of each taxable supply when statuses differ',
    citation: 'SOR/91-45 s.3(b)(v)',
    appliesFromTier: 2,
    fix: 'If this line is taxable, ask the supplier to mark it as taxable (for example with a tax code). If it is exempt or zero-rated, no change is needed.',
  },
  ({ invoice }, report) => {
    // s.3(b)(v) applies "where the status of two or more supplies is
    // different" and asks for the status of each TAXABLE, non-zero-rated
    // supply. A line marked exempt or zero-rated shows statuses can differ, so
    // an unmarked line may be a taxable supply that needed marking. If no line
    // is marked exempt/zero-rated, nothing shows that statuses differ.
    // (Maintainer decision, docs/decisions.md.)
    const { lines } = invoice;
    if (lines.length < 2 || !lines.some(isStatedNonTaxable)) return;
    lines.forEach((line, i) => {
      if (line.taxStatus !== undefined) return;
      const label = line.description === undefined ? '' : ` ("${line.description}")`;
      report({
        field: `lines[${i}].taxStatus`,
        message: `Line ${i + 1}${label} doesn't say whether it is taxable. Other lines on this invoice are exempt or zero-rated, so every taxable supply must be marked as taxable to support an input tax credit.`,
      });
    });
  },
);

// ---------------------------------------------------------------------------
// Tier 3: s.3(c)
// ---------------------------------------------------------------------------

export const buyerName = defineRule<CaContext>(
  {
    id: 'CA-ITC-020',
    severity: 'warning',
    title: 'Buyer name or trading name',
    citation: 'SOR/91-45 s.3(c)(ii)',
    appliesFromTier: 3,
    fix: 'Ask the supplier to put your business name (or trading name) on the invoice.',
  },
  ({ invoice }, report) => {
    if (invoice.buyer?.name !== undefined || invoice.buyer?.tradingName !== undefined) return;
    report({
      field: 'buyer.name',
      message: `This invoice totals ${dollars(invoice.total)} including tax. Invoices of $500 or more need the buyer's name (or trading name, or authorized agent's name) to support an input tax credit, and this document alone doesn't show one.`,
    });
  },
);

export const paymentTerms = defineRule<CaContext>(
  {
    id: 'CA-ITC-021',
    severity: 'warning',
    title: 'Terms of payment',
    citation: 'SOR/91-45 s.3(c)(iii)',
    appliesFromTier: 3,
    fix: 'Ask the supplier for an invoice that states the payment terms (for example "Net 30" or "Paid by credit card").',
  },
  ({ invoice }, report) => {
    if (invoice.paymentTerms !== undefined) return;
    report({
      field: 'paymentTerms',
      message:
        'Invoices of $500 or more need the terms of payment (for example "Net 30" or "Paid by credit card") to support an input tax credit. This document alone doesn\'t show them.',
    });
  },
);

/** One-word descriptions too vague to identify a supply on their own. */
const GENERIC_DESCRIPTIONS = new Set([
  'services',
  'service',
  'misc',
  'miscellaneous',
  'items',
  'item',
  'goods',
  'products',
  'product',
  'supplies',
  'various',
  'sundry',
  'sundries',
  'other',
  'fees',
  'fee',
  'charges',
  'materials',
  'parts',
  'labour',
  'labor',
  'work',
]);

const normalizeDescription = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .trim();

export const supplyDescription = defineRule<CaContext>(
  {
    id: 'CA-ITC-022',
    severity: 'warning',
    title: 'Description sufficient to identify each supply',
    citation: 'SOR/91-45 s.3(c)(iv)',
    appliesFromTier: 3,
    fix: 'Ask the supplier for a description that identifies what was supplied (for example "Laptop repair, 2 hours" rather than "Services").',
  },
  ({ invoice }, report) => {
    if (invoice.lines.length === 0) {
      report({
        field: 'lines',
        message:
          "This document doesn't list what was supplied. Invoices of $500 or more need a description of each supply that's specific enough to identify it.",
      });
      return;
    }
    invoice.lines.forEach((line, i) => {
      const description = line.description ?? '';
      if (description.length < 3) {
        report({
          field: `lines[${i}].description`,
          message: `Line ${i + 1} has ${description === '' ? 'no description' : `only "${description}" as a description`}. Invoices of $500 or more need a description of each supply that's specific enough to identify it.`,
        });
      } else if (GENERIC_DESCRIPTIONS.has(normalizeDescription(description))) {
        report({
          field: `lines[${i}].description`,
          severity: 'info',
          message: `Line ${i + 1} is described only as "${description}", which may not be specific enough to identify the supply.`,
        });
      }
    });
  },
);

export const itcRules = [
  supplierName,
  invoiceDate,
  registrationNumber,
  taxDisclosure,
  taxIncludedRate,
  statusIndication,
  buyerName,
  paymentTerms,
  supplyDescription,
];
