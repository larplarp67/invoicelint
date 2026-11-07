/**
 * UBL 2.1 Invoice (Peppol BIS Billing 3.0 style) -> canonical invoice.
 *
 * Element paths follow the Peppol BIS Billing 3.0 UBL syntax tree:
 * https://docs.peppol.eu/poacc/billing/3.0/syntax/ubl-invoice/tree/
 * Mapping decisions: docs/decisions.md ("Phase 4: UBL input").
 *
 * Same contract as the JSON parser: bad input never throws. A successful
 * parse may carry `issues` (infos about what wasn't mapped, and consistency
 * errors such as currency mismatches) that belong in the report.
 */
import { PROVINCES, type Invoice, type Province } from '../model.ts';
import { parseDecimal, parseMoney } from '../money.ts';
import type { Issue, Severity } from '../types.ts';
import { parseJsonInvoice } from './json.ts';
import {
  DEFAULT_MAX_XML_BYTES,
  type XmlElement,
  child,
  children,
  parseXml,
  path,
  textOf,
} from './xml.ts';

export const UBL_NS = {
  INVOICE: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  CREDIT_NOTE: 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2',
  CAC: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  CBC: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
} as const;

export const UBL_ISSUES = {
  /** Root element is not a UBL 2.1 Invoice. */
  NOT_INVOICE: 'PARSE-UBL-001',
  /** Credit notes are not supported yet. */
  CREDIT_NOTE: 'PARSE-UBL-010',
  /** Line tax category code other than S, Z or E. */
  TAX_CATEGORY: 'PARSE-UBL-020',
  /** Tax subtotal that can't be classified as GST, HST, PST or QST. */
  TAX_TYPE: 'PARSE-UBL-021',
  /** A value present in the XML that was deliberately not mapped. */
  NOT_MAPPED: 'PARSE-UBL-022',
  /** An amount's currencyID differs from DocumentCurrencyCode. */
  CURRENCY: 'PARSE-UBL-030',
  /** A required element is missing. */
  REQUIRED: 'PARSE-UBL-031',
} as const;

export type UblParseResult =
  { ok: true; invoice: Invoice; issues: Issue[] } | { ok: false; parseErrors: Issue[] };

export interface UblOptions {
  /** Maximum input size in bytes. Default 5 MB. */
  maxBytes?: number;
}

const cbc = (local: string) => [UBL_NS.CBC, local] as const;
const cac = (local: string) => [UBL_NS.CAC, local] as const;

// UNCL5305 duty/tax category codes (names for messages).
const TAX_CATEGORY_NAMES: Record<string, string> = {
  AE: 'VAT reverse charge',
  B: 'transferred VAT (Italy)',
  G: 'export outside the EU, free of VAT',
  K: 'intra-community supply (EU)',
  L: 'Canary Islands general indirect tax',
  M: 'tax for production, services and importation in Ceuta and Melilla',
  O: 'services outside the scope of tax',
};
const TAX_STATUS_BY_CATEGORY: Record<string, 'taxable' | 'zero-rated' | 'exempt'> = {
  S: 'taxable',
  Z: 'zero-rated',
  E: 'exempt',
};
const CANADIAN_TAX_SCHEMES = new Set(['GST', 'HST', 'PST', 'QST']);

// ---------------------------------------------------------------------------
// Province names -> codes
// ---------------------------------------------------------------------------

const PROVINCE_NAMES: Record<string, Province> = {
  alberta: 'AB',
  'british columbia': 'BC',
  'colombie britannique': 'BC',
  manitoba: 'MB',
  'new brunswick': 'NB',
  'nouveau brunswick': 'NB',
  newfoundland: 'NL',
  'newfoundland and labrador': 'NL',
  'terre neuve et labrador': 'NL',
  'northwest territories': 'NT',
  'territoires du nord ouest': 'NT',
  'nova scotia': 'NS',
  'nouvelle ecosse': 'NS',
  nunavut: 'NU',
  ontario: 'ON',
  'prince edward island': 'PE',
  'ile du prince edouard': 'PE',
  quebec: 'QC',
  saskatchewan: 'SK',
  yukon: 'YT',
};

/** "ON", "Ontario", "ONTARIO", "CA-ON", "Québec" -> province code; undefined if unknown. */
export function normalizeProvince(value: string): Province | undefined {
  const key = value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();
  const code = /^(?:ca )?([a-z]{2})$/.exec(key)?.[1]?.toUpperCase();
  if (code !== undefined && (PROVINCES as readonly string[]).includes(code))
    return code as Province;
  return PROVINCE_NAMES[key];
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

class Collector {
  readonly issues: Issue[] = [];

  add(ruleId: string, severity: Severity, field: string, message: string, fix?: string): void {
    this.issues.push({ ruleId, severity, field, message, ...(fix ? { fix } : {}) });
  }
}

const upper = (s: string | undefined): string | undefined => s?.trim().toUpperCase();

function joinParts(parts: readonly (string | undefined)[], sep: string): string | undefined {
  const present = parts.filter((p): p is string => p !== undefined && p !== '');
  return present.length > 0 ? present.join(sep) : undefined;
}

function mapInvoice(root: XmlElement): UblParseResult {
  const out = new Collector();
  const currency = upper(textOf(child(root, ...cbc('DocumentCurrencyCode'))));

  /** Text of an amount element, after checking its currencyID against the document currency. */
  const amount = (el: XmlElement | undefined, field: string, label: string): string | undefined => {
    const text = textOf(el);
    const cur = upper(el?.attrs.currencyID);
    if (text !== undefined && cur !== undefined && currency !== undefined && cur !== currency) {
      out.add(
        UBL_ISSUES.CURRENCY,
        'error',
        field,
        `${label} is in ${cur}, but the invoice currency (DocumentCurrencyCode) is ${currency}.`,
        'Ask the supplier for an invoice with every amount in the invoice currency.',
      );
    }
    return text;
  };

  // --- Required header elements ---------------------------------------------
  const invoiceNumber = textOf(child(root, ...cbc('ID')));
  const issueDate = textOf(child(root, ...cbc('IssueDate')));
  const lmt = child(root, ...cac('LegalMonetaryTotal'));
  const totalEl = child(lmt, ...cbc('TaxInclusiveAmount'));
  const required: [string | undefined, string, string][] = [
    [invoiceNumber, 'invoiceNumber', 'cbc:ID (invoice number)'],
    [issueDate, 'issueDate', 'cbc:IssueDate (invoice date)'],
    [currency, 'currency', 'cbc:DocumentCurrencyCode (invoice currency)'],
    [
      textOf(totalEl),
      'total',
      'cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount (total including tax)',
    ],
  ];
  for (const [value, field, element] of required) {
    if (value === undefined) {
      out.add(
        UBL_ISSUES.REQUIRED,
        'error',
        field,
        `The UBL invoice is missing ${element}, which every UBL invoice must have.`,
        'Ask the supplier to resend a complete e-invoice.',
      );
    }
  }
  if (textOf(totalEl) === undefined) return { ok: false, parseErrors: out.issues };

  // --- Seller ----------------------------------------------------------------
  const sellerParty = path(root, cac('AccountingSupplierParty'), cac('Party'));
  const sellerAddress = child(sellerParty, ...cac('PostalAddress'));
  const sellerCountry = upper(
    textOf(path(sellerAddress, cac('Country'), cbc('IdentificationCode'))),
  );
  const looksCanadian =
    sellerCountry === 'CA' || (sellerCountry === undefined && currency === 'CAD');
  const notCanadaReason =
    sellerCountry === undefined
      ? "the seller's country isn't stated and the invoice isn't in CAD"
      : `the seller's country is ${sellerCountry}`;

  const supplier: Record<string, string> = {};
  const sellerName =
    textOf(path(sellerParty, cac('PartyName'), cbc('Name'))) ??
    textOf(path(sellerParty, cac('PartyLegalEntity'), cbc('RegistrationName')));
  if (sellerName !== undefined) supplier.name = sellerName;

  const taxSchemes = children(sellerParty, ...cac('PartyTaxScheme'))
    .map((pts) => ({
      id: textOf(child(pts, ...cbc('CompanyID'))),
      scheme: upper(textOf(path(pts, cac('TaxScheme'), cbc('ID')))),
    }))
    .filter((s): s is { id: string; scheme: string | undefined } => s.id !== undefined);
  const rank = (scheme: string | undefined): number =>
    scheme !== undefined && /GST|HST|TPS|TVH/.test(scheme) ? 0 : scheme === 'VAT' ? 2 : 1;
  const taxId = [...taxSchemes].sort((a, b) => rank(a.scheme) - rank(b.scheme))[0]?.id;
  if (taxId !== undefined) {
    if (looksCanadian) {
      supplier.gstHstNumber = taxId;
    } else {
      out.add(
        UBL_ISSUES.NOT_MAPPED,
        'info',
        'supplier.gstHstNumber',
        `The seller's tax number "${taxId}" was not treated as a GST/HST number, because ${notCanadaReason}.`,
      );
    }
  }

  const subentity =
    textOf(child(sellerAddress, ...cbc('CountrySubentity'))) ??
    textOf(child(sellerAddress, ...cbc('CountrySubentityCode')));
  if (subentity !== undefined && looksCanadian) {
    const province = normalizeProvince(subentity);
    if (province !== undefined) {
      supplier.province = province;
    } else {
      out.add(
        UBL_ISSUES.NOT_MAPPED,
        'info',
        'supplier.province',
        `The seller's province "${subentity}" isn't a Canadian province or territory, so it was left out.`,
      );
    }
  }
  const address = joinParts(
    [
      textOf(child(sellerAddress, ...cbc('StreetName'))),
      textOf(child(sellerAddress, ...cbc('AdditionalStreetName'))),
      textOf(path(sellerAddress, cac('AddressLine'), cbc('Line'))),
      textOf(child(sellerAddress, ...cbc('CityName'))),
      subentity,
      textOf(child(sellerAddress, ...cbc('PostalZone'))),
      sellerCountry,
    ],
    ', ',
  );
  if (address !== undefined) supplier.address = address;

  // --- Buyer -----------------------------------------------------------------
  const buyerParty = path(root, cac('AccountingCustomerParty'), cac('Party'));
  const buyer: Record<string, string> = {};
  const buyerName = textOf(path(buyerParty, cac('PartyLegalEntity'), cbc('RegistrationName')));
  const buyerTradingName = textOf(path(buyerParty, cac('PartyName'), cbc('Name')));
  if (buyerName !== undefined) buyer.name = buyerName;
  if (buyerTradingName !== undefined) buyer.tradingName = buyerTradingName;

  // --- Payment terms ---------------------------------------------------------
  const termNotes = children(root, ...cac('PaymentTerms')).map((pt) =>
    textOf(child(pt, ...cbc('Note'))),
  );
  const dueDate = textOf(child(root, ...cbc('DueDate')));
  const paymentTerms =
    joinParts(termNotes, '; ') ?? (dueDate === undefined ? undefined : `Due ${dueDate}`);

  // --- Lines -----------------------------------------------------------------
  const lines = children(root, ...cac('InvoiceLine')).map((lineEl, i) => {
    const line: Record<string, string> = {};
    const where = `lines[${i}]`;
    const lineTotal = amount(
      child(lineEl, ...cbc('LineExtensionAmount')),
      `${where}.lineTotal`,
      `Line ${i + 1} amount`,
    );
    if (lineTotal !== undefined) line.lineTotal = lineTotal;

    const item = child(lineEl, ...cac('Item'));
    const name = textOf(child(item, ...cbc('Name')));
    const desc = textOf(child(item, ...cbc('Description')));
    const description =
      name !== undefined && desc !== undefined && desc !== name
        ? `${name} — ${desc}`
        : (name ?? desc);
    if (description !== undefined) line.description = description;

    const qty = textOf(child(lineEl, ...cbc('InvoicedQuantity')));
    if (qty !== undefined) {
      const q = parseDecimal(qty, { maxScale: 6 });
      if (q.ok) line.quantity = q.value;
      else
        out.add(
          UBL_ISSUES.NOT_MAPPED,
          'info',
          `${where}.quantity`,
          `Line ${i + 1} quantity: ${q.reason}; left out.`,
        );
    }

    const price = child(lineEl, ...cac('Price'));
    const priceText = amount(
      child(price, ...cbc('PriceAmount')),
      `${where}.unitPrice`,
      `Line ${i + 1} price`,
    );
    const baseQty = textOf(child(price, ...cbc('BaseQuantity')));
    const base = baseQty === undefined ? undefined : parseDecimal(baseQty);
    const baseIsOne = base === undefined || (base.ok && base.value === '1');
    if (priceText !== undefined) {
      const p = parseMoney(priceText);
      if (!baseIsOne) {
        out.add(
          UBL_ISSUES.NOT_MAPPED,
          'info',
          `${where}.unitPrice`,
          `Line ${i + 1} price ${priceText} is for ${baseQty ?? ''} units, not one, so the unit price was left out.`,
        );
      } else if (p.ok) {
        line.unitPrice = priceText;
      } else {
        out.add(
          UBL_ISSUES.NOT_MAPPED,
          'info',
          `${where}.unitPrice`,
          `Line ${i + 1} unit price ${priceText} has fractions of a cent, so it was left out (line amounts are still checked).`,
        );
      }
    }

    const category = upper(textOf(path(item, cac('ClassifiedTaxCategory'), cbc('ID'))));
    if (category !== undefined) {
      const status = TAX_STATUS_BY_CATEGORY[category];
      if (status !== undefined) {
        line.taxStatus = status;
      } else {
        const known = TAX_CATEGORY_NAMES[category];
        out.add(
          UBL_ISSUES.TAX_CATEGORY,
          'info',
          `${where}.taxStatus`,
          `Line ${i + 1} has tax category "${category}"${known ? ` (${known})` : ''}, which has no GST/HST equivalent, so its tax status was left unset.`,
        );
      }
    }
    return line;
  });

  // --- Taxes -----------------------------------------------------------------
  const taxTotals = children(root, ...cac('TaxTotal'));
  const taxTotal =
    taxTotals.find((t) => upper(child(t, ...cbc('TaxAmount'))?.attrs.currencyID) === currency) ??
    taxTotals.find((t) => children(t, ...cac('TaxSubtotal')).length > 0) ??
    taxTotals[0];

  const taxes: Record<string, string>[] = [];
  children(taxTotal, ...cac('TaxSubtotal')).forEach((sub, j) => {
    const k = taxes.length;
    const where = `taxes[${k}]`;
    const category = child(sub, ...cac('TaxCategory'));
    const categoryId = upper(textOf(child(category, ...cbc('ID'))));
    const percentText = textOf(child(category, ...cbc('Percent')));
    const scheme = upper(textOf(path(category, cac('TaxScheme'), cbc('ID'))));
    const amountText = amount(
      child(sub, ...cbc('TaxAmount')),
      `${where}.amount`,
      `Tax subtotal ${j + 1} amount`,
    );
    const taxable = amount(
      child(sub, ...cbc('TaxableAmount')),
      `${where}.taxableAmount`,
      `Tax subtotal ${j + 1} taxable amount`,
    );

    // A subtotal with no tax charged (zero-rated, exempt, outside scope, ...) adds nothing.
    const charged = amountText === undefined ? undefined : parseMoney(amountText);
    if (charged?.ok && charged.value === 0 && categoryId !== undefined && categoryId !== 'S')
      return;

    const rate = percentText === undefined ? undefined : parseDecimal(percentText, { maxScale: 4 });
    let type: string;
    if (scheme !== undefined && CANADIAN_TAX_SCHEMES.has(scheme)) {
      type = scheme;
    } else if (looksCanadian && rate?.ok && rate.value === '5') {
      type = 'GST';
    } else if (looksCanadian && rate?.ok && ['13', '14', '15'].includes(rate.value)) {
      type = 'HST';
    } else {
      type = 'OTHER';
      const what = `${scheme ?? 'tax'}${percentText === undefined ? '' : ` at ${percentText}%`}`;
      const why = looksCanadian
        ? 'its rate is not a GST (5%) or HST (13%, 14%, 15%) rate'
        : notCanadaReason;
      out.add(
        UBL_ISSUES.TAX_TYPE,
        'info',
        `${where}.type`,
        `Tax subtotal ${j + 1} (${what}) was not classified as GST or HST, because ${why}. It still counts in the totals as "other tax".`,
      );
    }

    const tax: Record<string, string> = { type };
    if (percentText !== undefined) tax.rate = percentText;
    if (taxable !== undefined) tax.taxableAmount = taxable;
    if (amountText !== undefined) tax.amount = amountText;
    taxes.push(tax);
  });

  // --- Totals ----------------------------------------------------------------
  const doc: Record<string, unknown> = { supplier, lines, taxes };
  if (invoiceNumber !== undefined) doc.invoiceNumber = invoiceNumber;
  if (issueDate !== undefined) doc.issueDate = issueDate;
  if (currency !== undefined) doc.currency = currency;
  if (buyerParty !== undefined && Object.keys(buyer).length > 0) doc.buyer = buyer;
  if (paymentTerms !== undefined) doc.paymentTerms = paymentTerms;
  const money: [string, string, string][] = [
    ['subtotal', 'LineExtensionAmount', 'Sum of line amounts'],
    ['allowanceTotal', 'AllowanceTotalAmount', 'Total allowances'],
    ['chargeTotal', 'ChargeTotalAmount', 'Total charges'],
    ['total', 'TaxInclusiveAmount', 'Total including tax'],
  ];
  for (const [field, element, label] of money) {
    const value = amount(child(lmt, ...cbc(element)), field, label);
    if (value !== undefined) doc[field] = value;
  }

  const parsed = parseJsonInvoice(doc);
  if (!parsed.ok) return { ok: false, parseErrors: [...out.issues, ...parsed.parseErrors] };
  return { ok: true, invoice: parsed.invoice, issues: out.issues };
}

/** Parse a UBL 2.1 Invoice into the canonical model. */
export function parseUblInvoice(xml: string, options: UblOptions = {}): UblParseResult {
  const tree = parseXml(xml, { maxBytes: options.maxBytes ?? DEFAULT_MAX_XML_BYTES });
  if (!tree.ok) return { ok: false, parseErrors: tree.issues };
  const { root } = tree;

  if (root.ns === UBL_NS.INVOICE && root.local === 'Invoice') return mapInvoice(root);

  if (root.ns === UBL_NS.CREDIT_NOTE && root.local === 'CreditNote') {
    return {
      ok: false,
      parseErrors: [
        {
          ruleId: UBL_ISSUES.CREDIT_NOTE,
          severity: 'info',
          field: '',
          message:
            'This is a UBL credit note. Credit notes are not supported yet, so no checks were run.',
          fix: 'Credit-note support is on the roadmap.',
        },
      ],
    };
  }

  const where = root.ns === '' ? 'in no namespace' : `in namespace "${root.ns}"`;
  return {
    ok: false,
    parseErrors: [
      {
        ruleId: UBL_ISSUES.NOT_INVOICE,
        severity: 'error',
        field: '',
        message: `This XML is not a UBL 2.1 invoice: its root element is <${root.local}> ${where}. Expected <Invoice> in namespace "${UBL_NS.INVOICE}".`,
        fix: 'Check that the file is a UBL 2.1 (Peppol BIS Billing 3.0) invoice.',
      },
    ],
  };
}
