import { describe, expect, it } from 'vitest';
import {
  luhnValid,
  normalize,
  validateRegistrationNumber,
} from '../../../src/packs/ca-gst-hst/bn.ts';
import { luhnCheckDigit, makeBn } from '../../helpers/luhn.ts';

const problemsOf = (input: string) => validateRegistrationNumber(input).problems;

// Synthetic numbers generated from arbitrary payloads, not real businesses.
const BN_A = makeBn('10293847');
const BN_B = makeBn('55512345');
const BN_C = makeBn('80000001');

describe('test helper', () => {
  it('computes known Luhn check digits', () => {
    // Standard published Luhn example: 7992739871 -> check digit 3.
    expect(luhnCheckDigit('7992739871')).toBe('3');
    expect(luhnValid('79927398713')).toBe(true);
    expect(luhnValid('79927398710')).toBe(false);
  });
});

describe('normalize', () => {
  it('strips spaces, hyphens and dots and uppercases', () => {
    expect(normalize(' 123 456-789.rt 0001 ')).toBe('123456789RT0001');
    const nbsp = String.fromCharCode(0xa0); // non-breaking space, common in copied text
    expect(normalize(`123\t456${nbsp}789`)).toBe('123456789');
  });
});

describe('validateRegistrationNumber', () => {
  it('accepts a real published GST/HST number (sanity check)', () => {
    // Printed publicly by Vistaprint Canada.
    expect(validateRegistrationNumber('757610928RT0001')).toEqual({
      ok: true,
      normalized: '757610928RT0001',
      bn9: '757610928',
      program: 'RT',
      reference: '0001',
      problems: [],
    });
  });

  it.each([BN_A, BN_B, BN_C])('accepts generated BN %s alone and with RT0001', (bn) => {
    expect(validateRegistrationNumber(bn).ok).toBe(true);
    expect(validateRegistrationNumber(`${bn}RT0001`).ok).toBe(true);
  });

  it('accepts spaces, hyphens and lowercase "rt"', () => {
    for (const input of [
      '757610928 RT 0001',
      '757 610 928 RT0001',
      '757-610-928-RT-0001',
      '757610928rt0001',
    ]) {
      const r = validateRegistrationNumber(input);
      expect(r.ok, input).toBe(true);
      expect(r.normalized).toBe('757610928RT0001');
    }
  });

  it('a 9-digit BN has no program or reference', () => {
    const r = validateRegistrationNumber(BN_A);
    expect(r).toEqual({ ok: true, normalized: BN_A, bn9: BN_A, problems: [] });
  });

  it('detects every single-digit typo (Luhn catches all of them)', () => {
    for (let pos = 0; pos < 9; pos++) {
      for (let d = 0; d <= 9; d++) {
        if (String(d) === BN_A[pos]) continue;
        const typo = BN_A.slice(0, pos) + String(d) + BN_A.slice(pos + 1);
        expect(problemsOf(`${typo}RT0001`), typo).toEqual(['check-digit']);
      }
    }
  });

  it('detects transposed adjacent digits', () => {
    // 757610928 -> swap "61" to "16"
    expect(problemsOf('757160928RT0001')).toEqual(['check-digit']);
    // Generated number: swap positions 2 and 3.
    const swapped = BN_B.slice(0, 2) + BN_B.charAt(3) + BN_B.charAt(2) + BN_B.slice(4);
    expect(BN_B.charAt(2)).not.toBe(BN_B.charAt(3));
    expect(problemsOf(swapped)).toEqual(['check-digit']);
  });

  it('documents the Luhn blind spot: swapping 0 and 9 is not detected', () => {
    // Known Luhn limitation. "...09..." <-> "...90..." keeps the same sum.
    const bn = makeBn('12309456');
    const i = bn.indexOf('09');
    const swapped = bn.slice(0, i) + '90' + bn.slice(i + 2);
    expect(validateRegistrationNumber(swapped).ok).toBe(true);
  });

  it('rejects 8 digits as a length problem', () => {
    expect(problemsOf('75761092')).toEqual(['length']);
    const r = validateRegistrationNumber('75761092RT0001');
    expect(r.problems).toEqual(['length']);
    expect(r).toMatchObject({ bn9: '75761092', program: 'RT', reference: '0001' });
  });

  it('rejects other program identifiers (e.g. RP payroll)', () => {
    const r = validateRegistrationNumber(`${BN_A}RP0001`);
    expect(r.problems).toEqual(['wrong-program']);
    expect(r.program).toBe('RP');
  });

  it('rejects letters in the BN', () => {
    expect(problemsOf('75761O928RT0001')).toEqual(['non-digit']); // letter O, not zero
    expect(problemsOf('ABCDEFGHI')).toEqual(['non-digit']);
    expect(validateRegistrationNumber('ABCDEFGHI').program).toBeUndefined();
  });

  it('rejects a bad reference number', () => {
    expect(problemsOf(`${BN_A}RT00O1`)).toEqual(['bad-reference']);
    expect(problemsOf(`${BN_A}RT01`)).toEqual(['bad-reference']);
    expect(problemsOf(`${BN_A}RT`)).toEqual(['bad-reference']);
  });

  it('rejects empty and over-long input', () => {
    expect(problemsOf('')).toEqual(['length']);
    expect(problemsOf(`${BN_A}RT00011`)).toEqual(['bad-reference']);
    expect(problemsOf('123456789123456')).toEqual(['length']);
  });

  it('reports several problems at once', () => {
    expect(problemsOf('12345678XRP12')).toEqual(['non-digit', 'wrong-program', 'bad-reference']);
  });
});
