/**
 * GST/HST registration number checks, at every tier, whenever a number is shown.
 * These are errors: a number that is shown but malformed is wrong data.
 */
import type { Invoice } from '../../../model.ts';
import { defineRule } from '../../types.ts';
import { type RegistrationProblem, validateRegistrationNumber } from '../bn.ts';
import type { CaContext } from '../context.ts';

interface ShownNumber {
  field: string;
  party: string;
  value: string;
}

function shownNumbers(invoice: Invoice): ShownNumber[] {
  const out: ShownNumber[] = [];
  if (invoice.supplier.gstHstNumber !== undefined) {
    out.push({
      field: 'supplier.gstHstNumber',
      party: 'supplier',
      value: invoice.supplier.gstHstNumber,
    });
  }
  if (invoice.intermediary?.gstHstNumber !== undefined) {
    out.push({
      field: 'intermediary.gstHstNumber',
      party: 'intermediary',
      value: invoice.intermediary.gstHstNumber,
    });
  }
  return out;
}

/** CRA program identifiers other than RT, for plain-language messages. */
const PROGRAM_NAMES: Record<string, string> = {
  RC: 'corporation income tax',
  RP: 'payroll',
  RR: 'registered charity',
  RZ: 'information return',
  RM: 'import-export',
};

const FORMAT_HINT = 'A GST/HST number is 9 digits, then RT and 4 digits (e.g. 123456789 RT 0001).';

const PROBLEM_TEXT: Record<Exclude<RegistrationProblem, 'wrong-program'>, string> = {
  length: 'has the wrong number of digits in its first part (it should be 9)',
  'non-digit': 'has letters or symbols where its first 9 characters should all be digits',
  'check-digit': 'fails the check-digit test, which usually means a digit was mistyped',
  'bad-reference': 'should end in 4 digits after "RT"',
};

function describeProgram(program: string): string {
  const name = PROGRAM_NAMES[program];
  return name === undefined
    ? `a CRA account number with the code "${program}"`
    : `a ${name} account number (code ${program})`;
}

export const registrationNumberFormat = defineRule<CaContext>(
  {
    id: 'CA-BN-001',
    severity: 'error',
    title: 'GST/HST number has the right format and check digit',
    citation: 'SOR/91-45 s.3(b)(i)',
    fix: "Compare the number with the supplier's records or the CRA GST/HST Registry, and ask for a corrected invoice if it's wrong.",
  },
  ({ invoice }, report) => {
    for (const shown of shownNumbers(invoice)) {
      const problems = validateRegistrationNumber(shown.value).problems.filter(
        (p): p is Exclude<RegistrationProblem, 'wrong-program'> => p !== 'wrong-program',
      );
      if (problems.length === 0) continue;
      const what = problems.map((p) => PROBLEM_TEXT[p]).join(', and ');
      report({
        field: shown.field,
        message: `The ${shown.party}'s GST/HST number "${shown.value}" ${what}. ${FORMAT_HINT}`,
      });
    }
  },
);

export const registrationNumberProgram = defineRule<CaContext>(
  {
    id: 'CA-BN-002',
    severity: 'error',
    title: 'Number is a GST/HST number (RT), not another CRA account',
    citation: 'SOR/91-45 s.3(b)(i)',
    fix: 'Ask the supplier for its GST/HST number: the one with RT after the first 9 digits.',
  },
  ({ invoice }, report) => {
    for (const shown of shownNumbers(invoice)) {
      const result = validateRegistrationNumber(shown.value);
      if (!result.problems.includes('wrong-program')) continue;
      report({
        field: shown.field,
        message: `The ${shown.party}'s number "${shown.value}" is ${describeProgram(result.program ?? '')}, not a GST/HST number. GST/HST numbers have RT after the first 9 digits.`,
      });
    }
  },
);

export const bnRules = [registrationNumberFormat, registrationNumberProgram];
