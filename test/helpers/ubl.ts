/**
 * Test helper: build UBL 2.1 invoices (Peppol BIS Billing 3.0 shape) from a
 * small spec, rendered with cbc:/cac: prefixes, default namespaces only, or
 * unusual prefixes. Used by the UBL tests and to generate fixture files.
 */
import { UBL_NS } from '../../src/parsers/ubl.ts';

type NsKey = 'doc' | 'cac' | 'cbc';
interface Node {
  ns: NsKey;
  name: string;
  attrs?: Record<string, string>;
  text?: string;
  children?: (Node | undefined)[];
}

export interface UblLine {
  name?: string | undefined;
  description?: string | undefined;
  qty?: string | undefined;
  amount: string;
  price?: string | undefined;
  baseQty?: string | undefined;
  /** UNCL5305 code; null = omit ClassifiedTaxCategory entirely (status not stated). */
  category?: string | null | undefined;
  percent?: string | undefined;
  amountCurrency?: string | undefined;
}

export interface UblTaxSubtotal {
  taxable: string;
  amount: string;
  category: string;
  percent?: string | undefined;
  /** TaxScheme/ID, default "VAT". */
  scheme?: string | undefined;
}

export interface UblSpec {
  root?: string | undefined;
  rootNs?: string | undefined;
  id?: string | null | undefined;
  issueDate?: string | null | undefined;
  dueDate?: string | undefined;
  currency?: string | null | undefined;
  seller?: {
    tradingName?: string | undefined;
    legalName?: string | undefined;
    taxIds?: { id: string | undefined; scheme: string }[];
    street?: string | undefined;
    city?: string | undefined;
    postal?: string | undefined;
    subentity?: string | undefined;
    subentityCode?: string | undefined;
    country?: string | undefined;
  } | null;
  buyer?:
    | { legalName?: string | undefined; tradingName?: string | undefined; country?: string }
    | null
    | undefined;
  paymentTerms?: string | undefined;
  lines: UblLine[];
  /** Omit for no TaxTotal at all. */
  taxTotals?:
    | {
        currency?: string | undefined;
        amount: string;
        subtotals?: UblTaxSubtotal[] | undefined;
      }[]
    | undefined;
  totals: {
    lineExtension?: string | undefined;
    taxExclusive?: string | undefined;
    taxInclusive?: string | null | undefined;
    allowance?: string | undefined;
    charge?: string | undefined;
    payable?: string | undefined;
  };
}

const NS_URI: Record<NsKey, string> = {
  doc: UBL_NS.INVOICE,
  cac: UBL_NS.CAC,
  cbc: UBL_NS.CBC,
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const n = (ns: NsKey, name: string, ...children: (Node | undefined)[]): Node => ({
  ns,
  name,
  children,
});
const t = (
  name: string,
  text: string | undefined,
  attrs?: Record<string, string>,
): Node | undefined =>
  text === undefined ? undefined : { ns: 'cbc', name, text, ...(attrs ? { attrs } : {}) };

function specToTree(s: UblSpec): Node {
  const cur = s.currency ?? 'CAD';
  const amt = (name: string, value: string | undefined, currency = cur) =>
    t(name, value, { currencyID: currency });

  const seller =
    s.seller === null
      ? undefined
      : n(
          'cac',
          'AccountingSupplierParty',
          n(
            'cac',
            'Party',
            s.seller?.tradingName === undefined
              ? undefined
              : n('cac', 'PartyName', t('Name', s.seller.tradingName)),
            n(
              'cac',
              'PostalAddress',
              t('StreetName', s.seller?.street),
              t('CityName', s.seller?.city),
              t('PostalZone', s.seller?.postal),
              t('CountrySubentity', s.seller?.subentity),
              t('CountrySubentityCode', s.seller?.subentityCode),
              n('cac', 'Country', t('IdentificationCode', s.seller?.country ?? 'CA')),
            ),
            ...(s.seller?.taxIds ?? []).map((tid) =>
              n(
                'cac',
                'PartyTaxScheme',
                t('CompanyID', tid.id),
                n('cac', 'TaxScheme', t('ID', tid.scheme)),
              ),
            ),
            s.seller?.legalName === undefined
              ? undefined
              : n('cac', 'PartyLegalEntity', t('RegistrationName', s.seller.legalName)),
          ),
        );

  const buyer =
    s.buyer === null || s.buyer === undefined
      ? undefined
      : n(
          'cac',
          'AccountingCustomerParty',
          n(
            'cac',
            'Party',
            s.buyer.tradingName === undefined
              ? undefined
              : n('cac', 'PartyName', t('Name', s.buyer.tradingName)),
            n(
              'cac',
              'PostalAddress',
              n('cac', 'Country', t('IdentificationCode', s.buyer.country ?? 'CA')),
            ),
            s.buyer.legalName === undefined
              ? undefined
              : n('cac', 'PartyLegalEntity', t('RegistrationName', s.buyer.legalName)),
          ),
        );

  const taxTotals = (s.taxTotals ?? []).map((tt) =>
    n(
      'cac',
      'TaxTotal',
      amt('TaxAmount', tt.amount, tt.currency ?? cur),
      ...(tt.subtotals ?? []).map((st) =>
        n(
          'cac',
          'TaxSubtotal',
          amt('TaxableAmount', st.taxable, tt.currency ?? cur),
          amt('TaxAmount', st.amount, tt.currency ?? cur),
          n(
            'cac',
            'TaxCategory',
            t('ID', st.category),
            t('Percent', st.percent),
            n('cac', 'TaxScheme', t('ID', st.scheme ?? 'VAT')),
          ),
        ),
      ),
    ),
  );

  const lines = s.lines.map((l, i) =>
    n(
      'cac',
      'InvoiceLine',
      t('ID', String(i + 1)),
      t('InvoicedQuantity', l.qty ?? '1', { unitCode: 'EA' }),
      amt('LineExtensionAmount', l.amount, l.amountCurrency ?? cur),
      n(
        'cac',
        'Item',
        t('Description', l.description),
        t('Name', l.name),
        l.category === null
          ? undefined
          : n(
              'cac',
              'ClassifiedTaxCategory',
              t('ID', l.category ?? 'S'),
              t('Percent', l.percent),
              n('cac', 'TaxScheme', t('ID', 'VAT')),
            ),
      ),
      n(
        'cac',
        'Price',
        amt('PriceAmount', l.price ?? l.amount),
        t('BaseQuantity', l.baseQty, { unitCode: 'EA' }),
      ),
    ),
  );

  const tot = s.totals;
  return {
    ns: 'doc',
    name: s.root ?? 'Invoice',
    children: [
      t(
        'CustomizationID',
        'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0',
      ),
      t('ProfileID', 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0'),
      s.id === null ? undefined : t('ID', s.id ?? 'INV-1'),
      s.issueDate === null ? undefined : t('IssueDate', s.issueDate ?? '2026-04-02'),
      t('DueDate', s.dueDate),
      t('InvoiceTypeCode', '380'),
      s.currency === null ? undefined : t('DocumentCurrencyCode', cur),
      seller,
      buyer,
      s.paymentTerms === undefined
        ? undefined
        : n('cac', 'PaymentTerms', t('Note', s.paymentTerms)),
      ...taxTotals,
      n(
        'cac',
        'LegalMonetaryTotal',
        amt('LineExtensionAmount', tot.lineExtension),
        amt('TaxExclusiveAmount', tot.taxExclusive),
        tot.taxInclusive === null ? undefined : amt('TaxInclusiveAmount', tot.taxInclusive),
        amt('AllowanceTotalAmount', tot.allowance),
        amt('ChargeTotalAmount', tot.charge),
        amt('PayableAmount', tot.payable ?? tot.taxInclusive ?? undefined),
      ),
      ...lines,
    ],
  };
}

export type UblStyle = 'prefixed' | 'default-namespaces' | 'odd-prefixes';

function render(
  node: Node,
  style: UblStyle,
  rootNs: string,
  depth: number,
  parentNs?: NsKey,
): string {
  const uri = node.ns === 'doc' ? rootNs : NS_URI[node.ns];
  const pad = '  '.repeat(depth);
  let qname: string;
  let decl = '';
  if (style === 'default-namespaces') {
    qname = node.name;
    if (node.ns !== parentNs) decl = ` xmlns="${uri}"`;
  } else {
    const prefixes: Record<NsKey, string> =
      style === 'prefixed'
        ? { doc: '', cac: 'cac', cbc: 'cbc' }
        : { doc: 'ubl', cac: 'agg', cbc: 'bas' };
    const p = prefixes[node.ns];
    qname = p === '' ? node.name : `${p}:${node.name}`;
    if (depth === 0) {
      decl =
        (prefixes.doc === '' ? ` xmlns="${uri}"` : ` xmlns:${prefixes.doc}="${uri}"`) +
        ` xmlns:${prefixes.cac}="${NS_URI.cac}" xmlns:${prefixes.cbc}="${NS_URI.cbc}"`;
    }
  }
  const attrs = Object.entries(node.attrs ?? {})
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join('');
  if (node.text !== undefined) return `${pad}<${qname}${decl}${attrs}>${esc(node.text)}</${qname}>`;
  const kids = (node.children ?? []).filter((c): c is Node => c !== undefined);
  if (kids.length === 0) return `${pad}<${qname}${decl}${attrs}/>`;
  return `${pad}<${qname}${decl}${attrs}>\n${kids
    .map((k) => render(k, style, rootNs, depth + 1, node.ns))
    .join('\n')}\n${pad}</${qname}>`;
}

/** Render a UBL invoice spec to XML. */
export function buildUbl(spec: UblSpec, style: UblStyle = 'prefixed'): string {
  const rootNs = spec.rootNs ?? (spec.root === 'CreditNote' ? UBL_NS.CREDIT_NOTE : UBL_NS.INVOICE);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${render(specToTree(spec), style, rootNs, 0)}\n`;
}

/** A complete Canadian tier-2 invoice ($250.00, Ontario, HST 13% as Peppol "VAT"). */
export const caTier2: UblSpec = {
  id: 'INV-2001',
  issueDate: '2026-04-02',
  currency: 'CAD',
  seller: {
    tradingName: 'Maple Leaf Printing',
    legalName: 'Maple Leaf Printing Inc.',
    taxIds: [{ id: '812345676RT0001', scheme: 'VAT' }],
    street: '100 Example St',
    city: 'Toronto',
    postal: 'M5V 0A1',
    subentity: 'Ontario',
    country: 'CA',
  },
  buyer: { legalName: 'Northwind Analytics Inc.', tradingName: 'Northwind' },
  paymentTerms: 'Net 30',
  lines: [
    {
      name: 'Business cards',
      description: '500 pcs, matte',
      amount: '150.00',
      qty: '1',
      percent: '13',
    },
    { name: 'Letterhead', description: '250 sheets', amount: '71.24', qty: '1', percent: '13' },
  ],
  taxTotals: [
    {
      amount: '28.76',
      subtotals: [{ taxable: '221.24', amount: '28.76', category: 'S', percent: '13' }],
    },
  ],
  totals: {
    lineExtension: '221.24',
    taxExclusive: '221.24',
    taxInclusive: '250.00',
  },
};
