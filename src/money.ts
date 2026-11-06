/**
 * Exact money and decimal helpers.
 *
 * All monetary amounts inside invoicelint are integer cents (`Cents`). Tax and
 * quantity math is done with BigInt on scaled integers, never with floats.
 */

/** An amount in minor units (cents). Always a safe integer. */
export type Cents = number;

/** How to round a result that falls exactly halfway between two cents. */
export type Rounding = 'half-away-from-zero' | 'half-even';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string };

// Optional sign, optional "$", digits with optional comma grouping, optional fraction.
const MONEY_RE = /^(-)?\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/;
// Plain decimal: optional sign, digits, optional fraction. No grouping, no symbols.
const DECIMAL_RE = /^(-)?(\d+)(?:\.(\d+))?$/;

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function toText(input: string | number): ParseResult<string> {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return { ok: false, reason: `${String(input)} is not a number` };
    // String() gives the shortest round-trip form, e.g. 1234.56 -> "1234.56".
    // Very large/small values come out in exponent form and are rejected below.
    return { ok: true, value: String(input) };
  }
  const text = input.trim();
  if (text === '') return { ok: false, reason: 'is empty' };
  return { ok: true, value: text };
}

/**
 * Parse a money amount into integer cents.
 *
 * Accepts numbers (`1234.56`) and strings (`"1234.56"`, `"1,234.56"`, `"$1,234.56"`,
 * `"-12.50"`). Rejects anything that is not an exact number of cents: `"12.345"`
 * fails, while `"12.340"` is fine. Floating-point noise such as `0.1 + 0.2`
 * (`0.30000000000000004`) also fails, because silently rounding money hides bugs.
 * Spaces as thousands separators and decimal commas (`"1 234,56"`) are not
 * accepted because they are ambiguous with comma grouping.
 */
export function parseMoney(input: string | number): ParseResult<Cents> {
  const text = toText(input);
  if (!text.ok) return text;
  const m = MONEY_RE.exec(text.value);
  if (!m) {
    return {
      ok: false,
      reason: `"${text.value}" is not a valid amount (expected e.g. 1234.56 or "1,234.56")`,
    };
  }
  const [, sign, intPart = '', frac = ''] = m;
  if (frac.length > 2 && /[^0]/.test(frac.slice(2))) {
    return {
      ok: false,
      reason: `"${text.value}" has more than 2 decimal places; amounts must be exact cents`,
    };
  }
  const cents =
    BigInt(intPart.replaceAll(',', '')) * 100n + BigInt(frac.slice(0, 2).padEnd(2, '0'));
  if (cents > MAX_SAFE) return { ok: false, reason: `"${text.value}" is too large` };
  const value = Number(cents);
  return { ok: true, value: sign && value !== 0 ? -value : value };
}

/** Format cents as a plain decimal string with comma grouping: 123456 -> "1,234.56". */
export function formatMoney(cents: Cents): string {
  if (!Number.isSafeInteger(cents)) throw new TypeError(`formatMoney: not integer cents: ${cents}`);
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = (abs % 100).toString().padStart(2, '0');
  return `${cents < 0 ? '-' : ''}${whole}.${frac}`;
}

/**
 * Parse a plain decimal (rates, quantities) into a normalized string.
 *
 * Normalized form has no leading zeros, no trailing fractional zeros and no
 * "-0": `"013.50"` -> `"13.5"`, `5` -> `"5"`. Keeping decimals as strings keeps
 * them exact; use {@link decimalToScaled} to do math with them.
 */
export function parseDecimal(
  input: string | number,
  opts: { maxScale?: number; min?: number; max?: number } = {},
): ParseResult<string> {
  const text = toText(input);
  if (!text.ok) return text;
  const m = DECIMAL_RE.exec(text.value);
  if (!m) return { ok: false, reason: `"${text.value}" is not a plain decimal number` };
  const [, sign, intPart = '', rawFrac = ''] = m;
  const frac = rawFrac.replace(/0+$/, '');
  if (opts.maxScale !== undefined && frac.length > opts.maxScale) {
    return {
      ok: false,
      reason: `"${text.value}" has more than ${opts.maxScale} decimal places`,
    };
  }
  const whole = intPart.replace(/^0+(?=\d)/, '');
  const isZero = /^0*$/.test(whole) && frac === '';
  const normalized = `${sign && !isZero ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
  const numeric = Number(normalized);
  if (opts.min !== undefined && numeric < opts.min) {
    return { ok: false, reason: `${normalized} is below the minimum of ${opts.min}` };
  }
  if (opts.max !== undefined && numeric > opts.max) {
    return { ok: false, reason: `${normalized} is above the maximum of ${opts.max}` };
  }
  return { ok: true, value: normalized };
}

/** Split a normalized decimal string into an integer and its scale: "14.975" -> [14975n, 3]. */
export function decimalToScaled(decimal: string): [units: bigint, scale: number] {
  const m = DECIMAL_RE.exec(decimal);
  if (!m) throw new TypeError(`decimalToScaled: not a decimal: ${decimal}`);
  const [, sign, intPart = '', frac = ''] = m;
  const units = BigInt(intPart + frac);
  return [sign ? -units : units, frac.length];
}

/** Integer division of n / d (d > 0) rounded to the nearest integer. */
function divRound(n: bigint, d: bigint, rounding: Rounding): bigint {
  const q = n / d; // truncates toward zero
  const r = n % d;
  if (r === 0n) return q;
  const twice = 2n * (r < 0n ? -r : r);
  const away = n < 0n ? q - 1n : q + 1n;
  if (twice > d) return away;
  if (twice < d) return q;
  // Exactly half.
  if (rounding === 'half-even') return q % 2n === 0n ? q : away;
  return away;
}

function toCents(value: bigint): Cents {
  if (value > MAX_SAFE || value < -MAX_SAFE) throw new RangeError('amount out of range');
  return Number(value);
}

/** Multiply cents by an exact decimal (e.g. a quantity) and round to cents. */
export function multiplyCents(
  cents: Cents,
  factor: string,
  rounding: Rounding = 'half-away-from-zero',
): Cents {
  const [units, scale] = decimalToScaled(factor);
  return toCents(divRound(BigInt(cents) * units, 10n ** BigInt(scale), rounding));
}

/**
 * Compute `ratePercent`% of an amount in cents, rounded to cents.
 * `percentOf(100000, "14.975")` -> 14975 (14.975% of $1,000.00 = $149.75).
 */
export function percentOf(
  cents: Cents,
  ratePercent: string,
  rounding: Rounding = 'half-away-from-zero',
): Cents {
  const [units, scale] = decimalToScaled(ratePercent);
  return toCents(divRound(BigInt(cents) * units, 100n * 10n ** BigInt(scale), rounding));
}
