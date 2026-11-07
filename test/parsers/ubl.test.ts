import { describe, expect, it } from 'vitest';
import type { Invoice } from '../../src/model.ts';
import {
  UBL_NS,
  type UblParseResult,
  normalizeProvince,
  parseUblInvoice,
} from '../../src/parsers/ubl.ts';
import type { Issue } from '../../src/types.ts';
import { type UblSpec, buildUbl, caTier2 } from '../helpers/ubl.ts';

function ok(r: UblParseResult): { invoice: Invoice; issues: Issue[] } {
  if (!r.ok) throw new Error(`expected a parsed invoice, got ${JSON.stringify(r.parseErrors)}`);
  return r;
}
const parse = (spec: UblSpec, style?: Parameters<typeof buildUbl>[1]) =>
  parseUblInvoice(buildUbl(spec, style));
const ids = (issues: Issue[]) => issues.map((i) => `${i.ruleId}:${i.severity}:${i.field}`);

describe('mapping a Canadian Peppol-style invoice', () => {
  const { invoice, issues } = ok(parse(caTier2));

  it('maps header, parties, terms, lines, taxes and totals', () => {
    expect(invoice).toEqual({
      invoiceNumber: 'INV-2001',
      issueDate: '2026-04-02',
      currency: 'CAD',
      supplier: {
        name: 'Maple Leaf Printing',
        gstHstNumber: '812345676RT0001',
        province: 'ON',
        address: '100 Example St, Toronto, Ontario, M5V 0A1, CA',
      },
      buyer: { name: 'Northwind Analytics Inc.', tradingName: 'Northwind' },
      paymentTerms: 'Net 30',
      lines: [
        {
          description: 'Business cards — 500 pcs, matte',
          quantity: '1',
          unitPrice: 15000,
          lineTotal: 15000,
          taxStatus: 'taxable',
        },
        {
          description: 'Letterhead — 250 sheets',
          quantity: '1',
          unitPrice: 7124,
          lineTotal: 7124,
          taxStatus: 'taxable',
        },
      ],
      taxes: [{ type: 'HST', rate: '13', taxableAmount: 22124, amount: 2876 }],
      subtotal: 22124,
      total: 25000,
    });
    expect(issues).toEqual([]);
  });

  it.each(['default-namespaces', 'odd-prefixes'] as const)(
    'gives the same result with %s (matched by namespace, not prefix)',
    (style) => {
      expect(ok(parse(caTier2, style)).invoice).toEqual(invoice);
    },
  );

  it('handles a UTF-8 BOM at the start', () => {
    const bom = String.fromCharCode(0xfeff);
    expect(ok(parseUblInvoice(bom + buildUbl(caTier2))).invoice).toEqual(invoice);
  });
});

describe('parties', () => {
  it('falls back to the legal name when there is no trading name', () => {
    const spec = { ...caTier2, seller: { ...caTier2.seller, tradingName: undefined } };
    expect(ok(parse(spec)).invoice.supplier.name).toBe('Maple Leaf Printing Inc.');
  });

  it('prefers a GST/HST tax scheme over VAT for the registration number', () => {
    const spec = {
      ...caTier2,
      seller: {
        ...caTier2.seller,
        taxIds: [
          { id: 'CA-VAT-OTHER', scheme: 'VAT' },
          { id: '812345676RT0001', scheme: 'GST' },
        ],
      },
    };
    expect(ok(parse(spec)).invoice.supplier.gstHstNumber).toBe('812345676RT0001');
  });

  it('parses an invoice with no buyer and no seller party', () => {
    const { invoice } = ok(parse({ ...caTier2, seller: null, buyer: null }));
    expect(invoice.supplier).toEqual({});
    expect(invoice.buyer).toBeUndefined();
  });

  it('maps a buyer with only a trading name', () => {
    const { invoice } = ok(parse({ ...caTier2, buyer: { tradingName: 'Northwind' } }));
    expect(invoice.buyer).toEqual({ tradingName: 'Northwind' });
  });

  it('does not treat a foreign seller VAT number as a GST/HST number', () => {
    const { invoice, issues } = ok(
      parse({
        ...caTier2,
        currency: 'EUR',
        seller: {
          ...caTier2.seller,
          country: 'NO',
          subentity: undefined,
          taxIds: [{ id: 'NO999888777MVA', scheme: 'VAT' }],
        },
      }),
    );
    expect(invoice.supplier.gstHstNumber).toBeUndefined();
    expect(ids(issues)).toContain('PARSE-UBL-022:info:supplier.gstHstNumber');
  });
});

describe('province normalization', () => {
  it.each([
    ['ON', 'ON'],
    ['Ontario', 'ON'],
    ['ONTARIO', 'ON'],
    ['CA-ON', 'ON'],
    ['qc', 'QC'],
    ['Québec', 'QC'],
    ['Quebec', 'QC'],
    ['Nouvelle-Écosse', 'NS'],
    ['Newfoundland and Labrador', 'NL'],
    ['Prince Edward Island', 'PE'],
    ['Île-du-Prince-Édouard', 'PE'],
  ])('%s -> %s', (input, code) => {
    expect(normalizeProvince(input)).toBe(code);
  });

  it.each(['Bavaria', 'XX', '', 'Ont.'])('%j -> undefined', (input) => {
    expect(normalizeProvince(input)).toBeUndefined();
  });

  it('reads CountrySubentityCode when CountrySubentity is absent', () => {
    const spec = {
      ...caTier2,
      seller: { ...caTier2.seller, subentity: undefined, subentityCode: 'CA-NS' },
    };
    expect(ok(parse(spec)).invoice.supplier.province).toBe('NS');
  });

  it('notes an unrecognized province for a Canadian seller', () => {
    const spec = { ...caTier2, seller: { ...caTier2.seller, subentity: 'Bavaria' } };
    const { invoice, issues } = ok(parse(spec));
    expect(invoice.supplier.province).toBeUndefined();
    expect(ids(issues)).toEqual(['PARSE-UBL-022:info:supplier.province']);
  });
});

describe('payment terms', () => {
  it('uses "Due <date>" when there are no PaymentTerms but there is a DueDate', () => {
    const { paymentTerms: _drop, ...spec } = caTier2;
    expect(ok(parse({ ...spec, dueDate: '2026-05-02' })).invoice.paymentTerms).toBe(
      'Due 2026-05-02',
    );
  });

  it('prefers PaymentTerms/Note over DueDate', () => {
    expect(ok(parse({ ...caTier2, dueDate: '2026-05-02' })).invoice.paymentTerms).toBe('Net 30');
  });
});

describe('lines', () => {
  const line = (overrides: Partial<UblSpec['lines'][number]>) =>
    parse({ ...caTier2, lines: [{ name: 'Item', amount: '221.24', percent: '13', ...overrides }] });

  it.each([
    ['S', 'taxable'],
    ['Z', 'zero-rated'],
    ['E', 'exempt'],
  ])('category %s -> %s', (category, status) => {
    expect(ok(line({ category })).invoice.lines[0]?.taxStatus).toBe(status);
  });

  it('leaves the status unset with PARSE-UBL-020 for reverse charge (AE)', () => {
    const { invoice, issues } = ok(line({ category: 'AE' }));
    expect(invoice.lines[0]?.taxStatus).toBeUndefined();
    expect(ids(issues)).toEqual(['PARSE-UBL-020:info:lines[0].taxStatus']);
    expect(issues[0]?.message).toMatch(/"AE" \(VAT reverse charge\)/);
  });

  it('leaves the status unset, silently, when there is no tax category', () => {
    const { invoice, issues } = ok(line({ category: null }));
    expect(invoice.lines[0]?.taxStatus).toBeUndefined();
    expect(issues).toEqual([]);
  });

  it('keeps amounts exact (no floats)', () => {
    const { invoice } = ok(
      parse({
        ...caTier2,
        lines: [
          { name: 'A', amount: '0.10' },
          { name: 'B', amount: '0.20' },
        ],
        totals: { lineExtension: '0.30', taxInclusive: '0.30' },
        taxTotals: [{ amount: '0.00' }],
      }),
    );
    expect(invoice.lines.map((l) => l.lineTotal)).toEqual([10, 20]);
    expect(invoice.subtotal).toBe(30);
  });

  it('leaves out a sub-cent unit price with a note, keeping the line', () => {
    const { invoice, issues } = ok(line({ price: '0.125', qty: '1769.92' }));
    expect(invoice.lines[0]?.unitPrice).toBeUndefined();
    expect(invoice.lines[0]?.lineTotal).toBe(22124);
    expect(ids(issues)).toEqual(['PARSE-UBL-022:info:lines[0].unitPrice']);
  });

  it('leaves out a price quoted per several units', () => {
    const { invoice, issues } = ok(line({ price: '2212.40', baseQty: '10', qty: '1' }));
    expect(invoice.lines[0]?.unitPrice).toBeUndefined();
    expect(issues[0]?.message).toMatch(/is for 10 units/);
  });
});

describe('taxes', () => {
  const withTaxes = (
    subtotals: NonNullable<UblSpec['taxTotals']>[number]['subtotals'],
    extra: Partial<UblSpec> = {},
  ) => parse({ ...caTier2, taxTotals: [{ amount: '0', subtotals }], ...extra });

  it.each([
    ['VAT', '5', 'GST'],
    ['VAT', '13', 'HST'],
    ['VAT', '14', 'HST'],
    ['VAT', '15.00', 'HST'],
    ['GST', '7', 'GST'], // explicit scheme wins, so CA-RATE-001 can catch the 7%
    ['HST', '13', 'HST'],
    ['PST', '7', 'PST'],
    ['QST', '9.975', 'QST'],
  ])('scheme %s at %s%% -> %s', (scheme, percent, type) => {
    const { invoice } = ok(
      withTaxes([{ taxable: '100.00', amount: '1.00', category: 'S', percent, scheme }]),
    );
    expect(invoice.taxes[0]?.type).toBe(type);
  });

  it('classifies an unexpected VAT rate as OTHER with PARSE-UBL-021', () => {
    const { invoice, issues } = ok(
      withTaxes([{ taxable: '100.00', amount: '7.00', category: 'S', percent: '7' }]),
    );
    expect(invoice.taxes[0]).toMatchObject({ type: 'OTHER', rate: '7' });
    expect(ids(issues)).toEqual(['PARSE-UBL-021:info:taxes[0].type']);
  });

  it('does not infer GST/HST for a non-Canadian seller', () => {
    const { invoice, issues } = ok(
      withTaxes([{ taxable: '100.00', amount: '13.00', category: 'S', percent: '13' }], {
        currency: 'EUR',
        seller: { ...caTier2.seller, country: 'GR', subentity: undefined, taxIds: [] },
      }),
    );
    expect(invoice.taxes[0]?.type).toBe('OTHER');
    expect(issues.find((i) => i.ruleId === 'PARSE-UBL-021')?.message).toMatch(
      /seller's country is GR/,
    );
  });

  it('skips subtotals that charge no tax (zero-rated / exempt categories)', () => {
    const { invoice } = ok(
      withTaxes([
        { taxable: '121.24', amount: '15.76', category: 'S', percent: '13' },
        { taxable: '100.00', amount: '0.00', category: 'Z', percent: '0' },
      ]),
    );
    expect(invoice.taxes).toEqual([
      { type: 'HST', rate: '13', taxableAmount: 12124, amount: 1576 },
    ]);
  });

  it('uses the TaxTotal in the document currency when there are two', () => {
    const { invoice } = ok(
      parse({
        ...caTier2,
        currency: 'USD',
        taxTotals: [
          { currency: 'CAD', amount: '39.00' },
          {
            amount: '28.76',
            subtotals: [{ taxable: '221.24', amount: '28.76', category: 'S', percent: '13' }],
          },
        ],
      }),
    );
    expect(invoice.taxes).toHaveLength(1);
    expect(invoice.taxes[0]?.amount).toBe(2876);
  });

  it('prefers the doc-currency TaxTotal that has subtotals over a summary-only one', () => {
    const subtotals = [{ taxable: '221.24', amount: '28.76', category: 'S', percent: '13' }];
    for (const order of [
      [{ amount: '28.76' }, { amount: '28.76', subtotals }],
      [{ amount: '28.76', subtotals }, { amount: '28.76' }],
    ]) {
      const { invoice } = ok(parse({ ...caTier2, taxTotals: order }));
      expect(invoice.taxes).toEqual([
        { type: 'HST', rate: '13', taxableAmount: 22124, amount: 2876 },
      ]);
    }
  });

  it('maps document-level allowance and charge totals', () => {
    const { invoice } = ok(
      parse({ ...caTier2, totals: { ...caTier2.totals, allowance: '10.00', charge: '5.00' } }),
    );
    expect(invoice).toMatchObject({ allowanceTotal: 1000, chargeTotal: 500 });
  });

  it('uses TaxInclusiveAmount as the total, not PayableAmount (which can be reduced by prepayment)', () => {
    const { invoice } = ok(parse({ ...caTier2, totals: { ...caTier2.totals, payable: '50.00' } }));
    expect(invoice.total).toBe(25000);
  });
});

describe('consistency errors', () => {
  it('PARSE-UBL-030: an amount in another currency (still parsed)', () => {
    const [first, second] = caTier2.lines;
    if (!first || !second) throw new Error('fixture');
    const r = parse({ ...caTier2, lines: [{ ...first, amountCurrency: 'USD' }, second] });
    const { issues } = ok(r);
    expect(ids(issues)).toEqual(['PARSE-UBL-030:error:lines[0].lineTotal']);
    expect(issues[0]?.message).toBe(
      'Line 1 amount is in USD, but the invoice currency (DocumentCurrencyCode) is CAD.',
    );
  });

  it('PARSE-UBL-031: missing ID and IssueDate are errors but the invoice is still parsed', () => {
    const { issues, invoice } = ok(parse({ ...caTier2, id: null, issueDate: null }));
    expect(ids(issues)).toEqual([
      'PARSE-UBL-031:error:invoiceNumber',
      'PARSE-UBL-031:error:issueDate',
    ]);
    expect(invoice.issueDate).toBeUndefined();
  });

  it('PARSE-UBL-031: missing TaxInclusiveAmount stops parsing', () => {
    const r = parse({ ...caTier2, totals: { ...caTier2.totals, taxInclusive: null } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(ids(r.parseErrors)).toEqual(['PARSE-UBL-031:error:total']);
  });

  it('a malformed amount is reported with the model field path', () => {
    const r = parse({ ...caTier2, totals: { ...caTier2.totals, taxInclusive: '250,00' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(ids(r.parseErrors)).toEqual(['PARSE-005:error:total']);
  });
});

describe('root element', () => {
  it('PARSE-UBL-010: a credit note is recognized, not crashed on', () => {
    const r = parse({ ...caTier2, root: 'CreditNote' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(ids(r.parseErrors)).toEqual(['PARSE-UBL-010:info:']);
      expect(r.parseErrors[0]?.message).toMatch(/recognized but not checked yet/);
    }
  });

  it.each([
    ['another document', '<Order xmlns="urn:oasis:names:specification:ubl:schema:xsd:Order-2"/>'],
    ['an Invoice in the wrong namespace', '<Invoice xmlns="urn:example:not-ubl"/>'],
    ['an Invoice in no namespace', '<Invoice/>'],
  ])('PARSE-UBL-001: %s', (_label, xml) => {
    const r = parseUblInvoice(xml);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(ids(r.parseErrors)).toEqual(['PARSE-UBL-001:error:']);
      expect(r.parseErrors[0]?.message).toContain(UBL_NS.INVOICE);
    }
  });

  it('passes XML-level errors through (malformed, DTD, size)', () => {
    const bad = parseUblInvoice('<Invoice>');
    expect(bad.ok ? [] : bad.parseErrors.map((i) => i.ruleId)).toEqual(['PARSE-UBL-002']);
    const big = parseUblInvoice(buildUbl(caTier2), { maxBytes: 100 });
    expect(big.ok ? [] : big.parseErrors.map((i) => i.ruleId)).toEqual(['PARSE-UBL-004']);
  });
});
