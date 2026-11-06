import { describe, expect, it } from 'vitest';
import {
  decimalToScaled,
  formatMoney,
  multiplyCents,
  parseDecimal,
  parseMoney,
  percentOf,
} from '../src/money.ts';

const cents = (input: string | number) => {
  const r = parseMoney(input);
  if (!r.ok) throw new Error(`expected ok for ${String(input)}: ${r.reason}`);
  return r.value;
};
const moneyError = (input: string | number) => {
  const r = parseMoney(input);
  if (r.ok) throw new Error(`expected failure for ${String(input)}, got ${r.value}`);
  return r.reason;
};

describe('parseMoney', () => {
  it.each([
    ['1,234.56', 123456],
    ['1234.56', 123456],
    ['$1,234.56', 123456],
    ['  12.5 ', 1250],
    ['12', 1200],
    ['0.01', 1],
    ['0', 0],
    ['-12.50', -1250],
    ['-$1,000.00', -100000],
    ['12.340', 1234], // extra trailing zeros are exact
    ['1,234,567.89', 123456789],
    ['007.10', 710],
  ])('parses string %j -> %d cents', (input, expected) => {
    expect(cents(input)).toBe(expected);
  });

  it.each([
    [1234.56, 123456],
    [0.1, 10],
    [19.99, 1999], // 19.99 * 100 === 1998.9999999999998 in floats; we never multiply
    [1.15, 115], // 1.15 * 100 === 114.99999999999999
    [-0, 0],
    [42, 4200],
  ])('parses number %d -> %d cents without float error', (input, expected) => {
    expect(cents(input)).toBe(expected);
  });

  it('never returns negative zero', () => {
    expect(Object.is(cents('-0.00'), 0)).toBe(true);
  });

  it.each(['12.345', '1.005', 1.005, 0.1 + 0.2])('rejects sub-cent amount %j', (input) => {
    expect(moneyError(input)).toMatch(/more than 2 decimal places/);
  });

  it.each(['', '   ', 'abc', '1,23.45', '12,34', '1 234,56', '1.2.3', '$', '--1', '1e3', 1e21])(
    'rejects malformed amount %j',
    (input) => {
      expect(parseMoney(input).ok).toBe(false);
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('rejects non-finite %d', (input) => {
    expect(moneyError(input)).toMatch(/not a number/);
  });

  it('rejects amounts beyond safe-integer cents', () => {
    expect(moneyError('900719925474099.92')).toMatch(/too large/);
    expect(cents('90071992547409.91')).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('formatMoney', () => {
  it.each([
    [123456, '1,234.56'],
    [0, '0.00'],
    [5, '0.05'],
    [-1250, '-12.50'],
    [100000000, '1,000,000.00'],
  ])('formats %d -> %s', (input, expected) => {
    expect(formatMoney(input)).toBe(expected);
  });

  it('round-trips with parseMoney', () => {
    for (const c of [0, 1, 99, 100, 123456, -98765, 9007199254740991]) {
      expect(cents(formatMoney(c))).toBe(c);
    }
  });

  it('throws on non-integer input (programmer error)', () => {
    expect(() => formatMoney(12.5)).toThrow(TypeError);
  });
});

describe('parseDecimal', () => {
  it.each([
    ['13', '13'],
    [13, '13'],
    ['013.50', '13.5'],
    ['9.975', '9.975'],
    [0.5, '0.5'],
    ['0.000', '0'],
    ['-0', '0'],
    ['-2.50', '-2.5'],
  ])('normalizes %j -> %s', (input, expected) => {
    const r = parseDecimal(input);
    expect(r).toEqual({ ok: true, value: expected });
  });

  it('enforces maxScale, min and max', () => {
    expect(parseDecimal('9.97512', { maxScale: 4 }).ok).toBe(false);
    expect(parseDecimal('9.97500', { maxScale: 3 }).ok).toBe(true);
    expect(parseDecimal('-1', { min: 0 }).ok).toBe(false);
    expect(parseDecimal('100.1', { max: 100 }).ok).toBe(false);
  });

  it('rejects grouping and symbols', () => {
    expect(parseDecimal('1,000').ok).toBe(false);
    expect(parseDecimal('13%').ok).toBe(false);
  });

  it('splits into scaled integers', () => {
    expect(decimalToScaled('14.975')).toEqual([14975n, 3]);
    expect(decimalToScaled('-2.5')).toEqual([-25n, 1]);
    expect(decimalToScaled('5')).toEqual([5n, 0]);
  });
});

describe('percentOf (tax math)', () => {
  it.each([
    [100000, '13', 13000], // $1,000 @ 13% = $130.00
    [100000, '14.975', 14975], // QC combined rate, exact
    [22124, '13', 2876], // 28.7612 -> 28.76
    [107143, '5', 5357], // 53.5715 -> 53.57
    [107143, '7', 7500], // 75.0001 -> 75.00
    [5, '13', 1], // 0.65 cents -> 1
    [0, '13', 0],
  ])('%d cents @ %s%% = %d cents', (base, rate, expected) => {
    expect(percentOf(base, rate)).toBe(expected);
  });

  it('rounds exact halves away from zero by default', () => {
    expect(percentOf(10, '5')).toBe(1); // 0.5 -> 1
    expect(percentOf(30, '5')).toBe(2); // 1.5 -> 2
    expect(percentOf(-10, '5')).toBe(-1); // -0.5 -> -1 (credit notes)
  });

  it('supports banker’s rounding', () => {
    expect(percentOf(10, '5', 'half-even')).toBe(0); // 0.5 -> 0
    expect(percentOf(30, '5', 'half-even')).toBe(2); // 1.5 -> 2
    expect(percentOf(-10, '5', 'half-even')).toBe(0); // -0.5 -> 0
  });

  it('does not round values just below or above a half', () => {
    expect(percentOf(1999, '5')).toBe(100); // 99.95 -> 100
    expect(percentOf(1989, '5')).toBe(99); // 99.45 -> 99
  });
});

describe('multiplyCents', () => {
  it('multiplies by exact decimal quantities', () => {
    expect(multiplyCents(1999, '3')).toBe(5997);
    expect(multiplyCents(12000, '2.5')).toBe(30000);
    expect(multiplyCents(333, '0.5')).toBe(167); // 166.5 -> 167
    expect(multiplyCents(333, '0.5', 'half-even')).toBe(166);
  });
});
