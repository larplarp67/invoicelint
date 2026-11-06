import { describe, expect, it } from 'vitest';
import { formatPath, parseJsonInvoice, type JsonParseResult } from '../../src/parsers/json.ts';
import type { Issue } from '../../src/types.ts';

function errors(result: JsonParseResult): Issue[] {
  if (result.ok) throw new Error('expected parse errors');
  return result.parseErrors;
}

const base = {
  issueDate: '2026-03-15',
  supplier: { name: 'Maple Supply Co.' },
  lines: [{ description: 'Paper', lineTotal: '40.00', taxStatus: 'taxable' }],
  taxes: [{ type: 'GST', rate: 5, amount: '2.00' }],
  total: '42.00',
};

describe('formatPath', () => {
  it.each([
    [[], ''],
    [['total'], 'total'],
    [['lines', 2, 'lineTotal'], 'lines[2].lineTotal'],
    [['supplier', 'gstHstNumber'], 'supplier.gstHstNumber'],
  ])('%j -> %s', (path, expected) => {
    expect(formatPath(path)).toBe(expected);
  });
});

describe('parseJsonInvoice', () => {
  it('parses a JSON string', () => {
    const result = parseJsonInvoice(JSON.stringify(base));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.invoice.total).toBe(4200);
      expect(result.invoice.taxes[0]?.rate).toBe('5');
    }
  });

  it('parses an object and a string with a UTF-8 BOM', () => {
    expect(parseJsonInvoice(base).ok).toBe(true);
    const bom = String.fromCharCode(0xfeff);
    expect(parseJsonInvoice(`${bom}${JSON.stringify(base)}`).ok).toBe(true);
    // Without stripping, JSON.parse rejects a leading BOM:
    expect(() => JSON.parse(`${bom}{}`) as unknown).toThrow(SyntaxError);
  });

  it('PARSE-001: invalid JSON syntax', () => {
    const [e, ...rest] = errors(parseJsonInvoice('{"total": 12,}'));
    expect(rest).toHaveLength(0);
    expect(e).toMatchObject({ ruleId: 'PARSE-001', severity: 'error', field: '' });
    expect(e?.message).toMatch(/not valid JSON/);
  });

  it.each(['[]', '"text"', '42', 'null'])('PARSE-002: top-level %s is not an object', (json) => {
    expect(errors(parseJsonInvoice(json))).toEqual([
      expect.objectContaining({ ruleId: 'PARSE-002', field: '' }),
    ]);
  });

  it('PARSE-002: an array passed as an object', () => {
    expect(errors(parseJsonInvoice([]))[0]?.ruleId).toBe('PARSE-002');
  });

  it('PARSE-003: missing required fields, with nested paths', () => {
    const noTotal: Partial<typeof base> = { ...base };
    delete noTotal.total;
    const result = parseJsonInvoice({
      ...noTotal,
      lines: [{ description: 'a', lineTotal: '1.00', taxStatus: 'taxable' }, { description: 'b' }],
    });
    expect(errors(result)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: 'PARSE-003', field: 'total' }),
        expect.objectContaining({ ruleId: 'PARSE-003', field: 'lines[1].lineTotal' }),
        expect.objectContaining({ ruleId: 'PARSE-003', field: 'lines[1].taxStatus' }),
      ]),
    );
    expect(errors(result).find((i) => i.field === 'total')?.message).toBe(
      '"total" is required but missing.',
    );
  });

  it('PARSE-004: wrong JSON types', () => {
    const result = parseJsonInvoice({
      ...base,
      total: true,
      supplier: 'Maple',
      lines: { description: 'x' },
      invoiceNumber: 1042,
    });
    const byField = Object.fromEntries(errors(result).map((i) => [i.field, i]));
    expect(byField.total).toMatchObject({
      ruleId: 'PARSE-004',
      message: '"total" must be a number or a decimal string, but got boolean.',
    });
    expect(byField.supplier).toMatchObject({
      ruleId: 'PARSE-004',
      message: '"supplier" must be an object, but got string.',
    });
    expect(byField.lines).toMatchObject({ ruleId: 'PARSE-004' });
    expect(byField.invoiceNumber).toMatchObject({ ruleId: 'PARSE-004' });
  });

  it('PARSE-004: null where a value is expected', () => {
    const e = errors(parseJsonInvoice({ ...base, total: null }))[0];
    expect(e).toMatchObject({ ruleId: 'PARSE-004', field: 'total' });
    expect(e?.message).toMatch(/but got null/);
  });

  it('PARSE-005: invalid values', () => {
    const result = parseJsonInvoice({
      ...base,
      issueDate: '2026-02-30',
      currency: 'cad',
      supplier: { name: 'X', province: 'QB' },
      lines: [
        { description: 'a', lineTotal: '1.00', taxStatus: 'taxable' },
        { description: 'b', lineTotal: '12.345', taxStatus: 'taxable' },
        { description: 'c', lineTotal: '1.00', taxStatus: 'taxed' },
      ],
      taxes: [{ type: 'VAT', rate: 105, amount: '1.00' }],
    });
    const byField = Object.fromEntries(errors(result).map((i) => [i.field, i]));
    for (const field of [
      'issueDate',
      'currency',
      'supplier.province',
      'lines[1].lineTotal',
      'lines[2].taxStatus',
      'taxes[0].type',
      'taxes[0].rate',
    ]) {
      expect(byField[field], field).toMatchObject({ ruleId: 'PARSE-005', severity: 'error' });
    }
    expect(byField.issueDate?.message).toBe(
      '"issueDate" is "2026-02-30", which is not a valid calendar date.',
    );
    expect(byField.issueDate?.fix).toMatch(/YYYY-MM-DD/);
    expect(byField['lines[1].lineTotal']?.message).toMatch(/more than 2 decimal places/);
    expect(byField['lines[2].taxStatus']?.message).toBe(
      '"lines[2].taxStatus" is "taxed", but must be one of: "taxable", "zero-rated", "exempt".',
    );
    expect(byField['taxes[0].rate']?.message).toMatch(/above the maximum of 100/);
  });

  it('reports every problem, not just the first', () => {
    const result = parseJsonInvoice({ total: 'abc', issueDate: 'yesterday', currency: 1 });
    expect(
      errors(result)
        .map((i) => i.field)
        .sort(),
    ).toEqual(['currency', 'issueDate', 'total']);
  });

  it('never throws on hostile-but-valid JSON', () => {
    for (const json of [
      '{}',
      '{"lines":[null]}',
      '{"taxes":[[]]}',
      '{"supplier":null}',
      '{"total":{}}',
    ]) {
      expect(() => parseJsonInvoice(json)).not.toThrow();
      expect(parseJsonInvoice(json).ok).toBe(false);
    }
  });

  it('throws TypeError on programmer errors', () => {
    // @ts-expect-error -- deliberately wrong argument type
    expect(() => parseJsonInvoice(42)).toThrow(TypeError);
    // @ts-expect-error -- deliberately wrong argument type
    expect(() => parseJsonInvoice(null)).toThrow(TypeError);
    // @ts-expect-error -- deliberately wrong argument type
    expect(() => parseJsonInvoice(undefined)).toThrow(TypeError);
  });
});
