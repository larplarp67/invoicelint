import { describe, expect, it } from 'vitest';
import { byRule, check, findings, tier2 } from '../../helpers/ca.ts';

const withNumber = (gstHstNumber: string) => ({
  ...tier2,
  supplier: { name: 'Supplier Inc.', gstHstNumber },
});

describe('CA-BN-001 well-formed number', () => {
  it('passes a valid number written with spaces', () => {
    expect(findings(check(withNumber('812345676 RT 0001')))).toEqual([]);
  });

  it.each([
    ['812345677RT0001', /fails the check-digit test/], // one wrong digit
    ['81234567RT0001', /wrong number of digits/],
    ['81234567ORT0001', /letters or symbols/],
    ['812345676RT01', /4 digits after "RT"/],
  ])('flags %s as an error', (number, message) => {
    const report = check(withNumber(number));
    expect(findings(report)).toEqual(['CA-BN-001']);
    expect(report.ok).toBe(false);
    const [issue] = byRule(report, 'CA-BN-001');
    expect(issue).toMatchObject({ severity: 'error', field: 'supplier.gstHstNumber' });
    expect(issue?.message).toMatch(message);
  });

  it('applies at tier 1 too, whenever a number is shown', () => {
    const report = check({
      supplier: { name: 'S', gstHstNumber: '812345677RT0001' },
      issueDate: '2026-01-05',
      total: '20.00',
    });
    expect(findings(report)).toEqual(['CA-BN-001']);
  });

  it("checks the intermediary's number too", () => {
    const report = check({
      ...tier2,
      intermediary: { name: 'Marketplace', gstHstNumber: '123' },
    });
    expect(byRule(report, 'CA-BN-001')[0]?.field).toBe('intermediary.gstHstNumber');
  });
});

describe('CA-BN-002 RT program', () => {
  it('flags a payroll (RP) account', () => {
    const report = check(withNumber('812345676RP0001'));
    expect(findings(report)).toEqual(['CA-BN-002']);
    expect(byRule(report, 'CA-BN-002')[0]?.message).toBe(
      'The supplier\'s number "812345676RP0001" is a payroll account number (code RP), not a GST/HST number. GST/HST numbers have RT after the first 9 digits.',
    );
  });

  it('reports format and program problems separately', () => {
    const report = check(withNumber('812345677RC0001'));
    expect(findings(report)).toEqual(['CA-BN-001', 'CA-BN-002']);
  });

  it('accepts lowercase "rt"', () => {
    expect(findings(check(withNumber('812345676rt0001')))).toEqual([]);
  });
});
