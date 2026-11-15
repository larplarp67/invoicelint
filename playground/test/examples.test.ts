import { describe, expect, it } from 'vitest';
import { checkInvoice } from '../src/check.ts';
import { DEFAULT_EXAMPLE_ID, EXAMPLES, exampleById } from '../src/examples.ts';
import { locateField } from '../src/locate.ts';

interface Expected {
  format: 'json' | 'ubl';
  /** Rule IDs the example must report: as errors or warnings, or for a clean one as info. */
  ruleIds: string[];
  /** No errors or warnings. */
  clean?: true;
}

/** What each example finds, so the menu keeps showing what its label promises. */
const EXPECTED: Record<string, Expected> = {
  'clean-tier-3': { format: 'json', ruleIds: ['CA-TIER-001'], clean: true },
  'plumber-missing-buyer-terms': { format: 'json', ruleIds: ['CA-ITC-020', 'CA-ITC-021'] },
  'gst-number-typo': { format: 'json', ruleIds: ['CA-BN-001'] },
  'ontario-gst-only': { format: 'json', ruleIds: ['CA-RATE-004'] },
  'hst-on-groceries': { format: 'json', ruleIds: ['CA-MATH-005'] },
  'ubl-xml': { format: 'ubl', ruleIds: ['CA-TIER-001'], clean: true },
};

function check(text: string) {
  const outcome = checkInvoice(text);
  if (outcome.kind !== 'checked')
    throw new Error(`expected a checked invoice, got ${outcome.kind}`);
  return outcome;
}

describe('playground examples', () => {
  it('has an expectation for every example in the menu', () => {
    expect(EXAMPLES.map((e) => e.id).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('starts with one of the menu examples', () => {
    expect(exampleById(DEFAULT_EXAMPLE_ID)).toBeDefined();
  });

  it.each(EXAMPLES.map((e) => [e.id, e] as const))('%s finds its expected rules', (id, example) => {
    const expected = EXPECTED[id];
    if (expected === undefined) throw new Error(`no expectation for ${id}`);
    const outcome = check(example.text);
    expect(outcome.format).toBe(expected.format);
    const { errors, warnings, infos } = outcome.report;
    if (expected.clean === true) {
      expect([...errors, ...warnings]).toEqual([]);
      expect(infos.map((i) => i.ruleId)).toEqual(expect.arrayContaining(expected.ruleIds));
    } else {
      const flagged = [...errors, ...warnings].map((i) => i.ruleId);
      expect(flagged).toEqual(expect.arrayContaining(expected.ruleIds));
    }
  });

  it.each(EXAMPLES.filter((e) => EXPECTED[e.id]?.format === 'json').map((e) => [e.id, e] as const))(
    '%s: every issue with a field can be shown in the editor',
    (_id, example) => {
      const { errors, warnings, infos } = check(example.text).report;
      for (const issue of [...errors, ...warnings, ...infos]) {
        if (issue.field === '') continue;
        expect(
          locateField(example.text, issue.field),
          `${issue.ruleId} ${issue.field}`,
        ).toBeDefined();
      }
    },
  );
});
