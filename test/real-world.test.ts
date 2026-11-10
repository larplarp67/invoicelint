/**
 * Real-world test invoices (test/real-world/, kept byte-for-byte as received).
 *
 * - invoices/: 30 generated invoices; expectations in expected.json, written by
 *   gen.mjs. run.mjs prints the same comparison against the built package.
 * - edge/: messy input and the gaps found in 0.1.0; expectations in
 *   expected-edge.json.
 *
 * `expect` is the exact list of error and warning rule IDs (as run.mjs compares
 * them); `infos`, when given, is the exact list of info rule IDs.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validate } from '../src/index.ts';

const DIR = join(import.meta.dirname, 'real-world');

interface Case {
  file: string;
  desc: string;
  expect: string[];
  infos?: string[];
}

const load = (manifest: string): Case[] =>
  JSON.parse(readFileSync(join(DIR, manifest), 'utf8')) as Case[];

const sets = [
  { dir: 'invoices', manifest: 'expected.json', cases: load('expected.json') },
  { dir: 'edge', manifest: 'expected-edge.json', cases: load('expected-edge.json') },
] as const;

const sorted = (ids: readonly string[]): string[] => [...ids].sort();

describe.each(sets)('real-world $dir/ ($manifest)', ({ dir, cases }) => {
  it('has an expectation for every file, and a file for every expectation', () => {
    expect(sorted(cases.map((c) => c.file))).toEqual(sorted(readdirSync(join(DIR, dir))));
  });

  it.each(cases.map((c) => [c.file, c] as const))('%s', (_file, c) => {
    const report = validate(readFileSync(join(DIR, dir, c.file), 'utf8'));
    const ids = (issues: readonly { ruleId: string }[]) => sorted(issues.map((i) => i.ruleId));
    expect(ids([...report.errors, ...report.warnings]), c.desc).toEqual(sorted(c.expect));
    if (c.infos !== undefined)
      expect(ids(report.infos), `${c.desc} (infos)`).toEqual(sorted(c.infos));

    if (c.expect.some((id) => id.startsWith('PARSE-'))) {
      // Rejected input: no rules ran, and every parse error says how to fix it.
      expect(report.packs).toEqual([]);
      for (const issue of report.errors) expect(issue.fix, `${issue.ruleId} fix`).toBeTruthy();
    } else {
      expect(report.packs.map((p) => p.id)).toEqual(['ca-gst-hst']);
    }
  });
});

describe('real-world: the cases behind 0.2.0', () => {
  const run = (path: string) => validate(readFileSync(join(DIR, path), 'utf8'));

  it('the main set has all 30 invoices', () => {
    expect(sets[0].cases).toHaveLength(30);
  });

  it('a negative total has no tier and no tier rules', () => {
    const report = run('edge/b-negative.json');
    expect(report.tier).toBeUndefined();
    expect(report.infos.map((i) => i.ruleId)).not.toContain('CA-TIER-001');
  });

  it('PARSE-005 for a 3-decimal amount has a Fix hint, like the bad-date one', () => {
    const [decimals] = run('edge/c-3-decimals.json').errors;
    const [date] = run('edge/e-bad-date.json').errors;
    expect(decimals).toMatchObject({ ruleId: 'PARSE-005', field: 'total' });
    expect(decimals?.fix).toMatch(/at most 2 decimal places/);
    expect(date?.fix).toBeTruthy();
  });

  it('CA-RATE-004 says to confirm place of supply, as a warning', () => {
    for (const path of [
      'edge/h-ontario-charging-gst-only.json',
      'invoices/29-ns-15-in-2026.json',
    ]) {
      const report = run(path);
      expect(report.ok, path).toBe(true);
      expect(report.warnings[0]?.message, path).toMatch(/confirm place of supply\.$/);
    }
  });
});
