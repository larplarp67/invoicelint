/**
 * Canadian Business Number (BN) and GST/HST registration number checks.
 *
 * A GST/HST registration number is a program account number: the 9-digit BN,
 * the program identifier "RT", and a 4-digit reference number, e.g.
 * 123456789RT0001. A bare 9-digit BN is also accepted here (structurally valid),
 * since it identifies the business. Whether a bare BN is enough on an invoice
 * is a rule decision: CA-BN-003 warns about it from tier 2.
 *
 * Check digit: the CRA does not publish a check-digit algorithm for the BN. The
 * last of the 9 digits behaves as a Luhn (mod 10) check digit, and this matches
 * python-stdnum's `stdnum.ca.bn` implementation, which applies `luhn.validate`
 * to the first 9 digits:
 * https://github.com/arthurdejong/python-stdnum/blob/master/stdnum/ca/bn.py
 * A number that passes is only well-formed. Only the CRA's GST/HST Registry can
 * confirm that it is actually registered.
 */

export type RegistrationProblem =
  'length' | 'non-digit' | 'check-digit' | 'wrong-program' | 'bad-reference';

export interface RegistrationNumberResult {
  /** True when no problems were found. */
  ok: boolean;
  /** Input with spaces, hyphens and dots removed, uppercased. */
  normalized: string;
  /** The business-number part (everything before the program identifier). 9 digits when well-formed. */
  bn9: string;
  /** Program identifier, e.g. "RT", when present. */
  program?: string;
  /** Reference number after the program identifier, e.g. "0001", when present. */
  reference?: string;
  problems: RegistrationProblem[];
}

/** The program identifier for GST/HST accounts. */
export const GST_HST_PROGRAM = 'RT';

/** Strip spaces, hyphens and dots, and uppercase. */
export function normalize(input: string): string {
  return input.replace(/[\s.-]/g, '').toUpperCase();
}

/** True when a digit string passes the Luhn (mod 10) check. */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * Split a normalized number into BN part, program identifier and reference.
 *
 * 1. Letters at positions 10-11 (the usual layout): split there, so a typo inside
 *    the BN ("O" for "0") stays in the BN and is reported as non-digit.
 * 2. Otherwise, digits followed by two letters: split at the letters, so a BN with
 *    a missing or extra digit ("75761092RT0001") is reported as a length problem
 *    instead of shifting every later character.
 * 3. Otherwise the whole input is the BN part.
 */
function split(normalized: string): { bn: string; program?: string; reference?: string } {
  if (/^[A-Z]{2}$/.test(normalized.slice(9, 11))) {
    return {
      bn: normalized.slice(0, 9),
      program: normalized.slice(9, 11),
      reference: normalized.slice(11),
    };
  }
  const m = /^([0-9]+)([A-Z]{2})(.*)$/.exec(normalized);
  if (m) return { bn: m[1] ?? '', program: m[2] ?? '', reference: m[3] ?? '' };
  return { bn: normalized };
}

/** Validate a GST/HST registration number (9-digit BN or BN + "RT" + 4 digits). */
export function validateRegistrationNumber(input: string): RegistrationNumberResult {
  const normalized = normalize(input);
  const { bn: bn9, program, reference } = split(normalized);
  const problems: RegistrationProblem[] = [];
  const result: RegistrationNumberResult = { ok: false, normalized, bn9, problems };

  if (bn9.length !== 9) problems.push('length');
  if (/[^0-9]/.test(bn9)) problems.push('non-digit');
  else if (bn9.length === 9 && !luhnValid(bn9)) problems.push('check-digit');

  if (program !== undefined) {
    result.program = program;
    if (reference) result.reference = reference;
    if (program !== GST_HST_PROGRAM) problems.push('wrong-program');
    if (!/^[0-9]{4}$/.test(reference ?? '')) problems.push('bad-reference');
  }

  result.ok = problems.length === 0;
  return result;
}
