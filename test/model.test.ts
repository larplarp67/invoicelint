import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { InvoiceSchema } from '../src/model.ts';
import { SCHEMA_PATH, renderSchema } from '../scripts/generate-schema.ts';

describe('InvoiceSchema', () => {
  it('accepts a minimal invoice and fills defaults', () => {
    const invoice = InvoiceSchema.parse({ total: '45.00' });
    expect(invoice).toEqual({
      currency: 'CAD',
      supplier: {},
      lines: [],
      taxes: [],
      total: 4500,
    });
  });

  it('converts money to cents and decimals to normalized strings', () => {
    const invoice = InvoiceSchema.parse({
      issueDate: '2026-03-15',
      supplier: { name: '  Maple Supply Co.  ', gstHstNumber: '123456782 RT 0001', province: 'ON' },
      lines: [
        {
          description: 'Paper',
          quantity: '2.50',
          unitPrice: 10,
          lineTotal: '25.00',
          taxStatus: 'taxable',
        },
      ],
      taxes: [{ type: 'HST', rate: '13.0', taxableAmount: 25, amount: '3.25' }],
      subtotal: 25,
      total: '28.25',
    });
    expect(invoice.supplier.name).toBe('Maple Supply Co.');
    expect(invoice.lines[0]).toEqual({
      description: 'Paper',
      quantity: '2.5',
      unitPrice: 1000,
      lineTotal: 2500,
      taxStatus: 'taxable',
    });
    expect(invoice.taxes[0]).toEqual({ type: 'HST', rate: '13', taxableAmount: 2500, amount: 325 });
    expect(invoice.total).toBe(2825);
  });

  it('treats blank strings as missing', () => {
    const invoice = InvoiceSchema.parse({ total: 1, supplier: { name: '   ' }, paymentTerms: '' });
    expect(invoice.supplier.name).toBeUndefined();
    expect(invoice.paymentTerms).toBeUndefined();
  });

  it('strips unknown properties', () => {
    const invoice = InvoiceSchema.parse({ total: 1, vendorExtension: { x: 1 } });
    expect(invoice).not.toHaveProperty('vendorExtension');
  });

  it.each([
    [{ total: 1, issueDate: '2026-02-30' }, 'issueDate'],
    [{ total: 1, currency: 'cad' }, 'currency'],
    [{ total: 1, supplier: { province: 'QB' } }, 'supplier.province'],
    [{ total: '12.345' }, 'total'],
    [{ total: 1, taxes: [{ type: 'GST', rate: 105, amount: 1 }] }, 'taxes.0.rate'],
    [{ total: 1, taxIncludedStatement: { included: false } }, 'taxIncludedStatement.included'],
    [{ total: 1, lines: [{ lineTotal: 1, taxStatus: 'taxed' }] }, 'lines.0.taxStatus'],
  ])('rejects %j at %s', (input, path) => {
    const r = InvoiceSchema.safeParse(input);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path.join('.'))).toContain(path);
  });
});

describe('schema/invoice.schema.json', () => {
  it('is up to date with the zod model (run `pnpm schema` to regenerate)', () => {
    expect(readFileSync(SCHEMA_PATH, 'utf8').replaceAll('\r\n', '\n')).toBe(renderSchema());
  });

  it('documents the input shape', () => {
    const schema = JSON.parse(renderSchema()) as {
      required: string[];
      properties: Record<string, { type?: unknown }>;
    };
    expect(schema.required).toEqual(['total']);
    expect(schema.properties.total?.type).toEqual(['string', 'number']);
  });
});
