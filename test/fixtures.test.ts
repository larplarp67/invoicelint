/**
 * Fixture-driven tests.
 *
 * Every fixture is a JSON invoice. An optional "$expect" block says what the
 * ca-gst-hst pack must report:
 *   findings: exact set of error/warning rule IDs (empty = none allowed)
 *   infos:    rule IDs that must appear among the infos
 *   tier:     expected tier
 * Valid fixtures default to { findings: [] } and must also add up exactly.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ValidationReport } from '../src/engine.ts';
import { multiplyCents, percentOf } from '../src/money.ts';
import { caGstHstPack } from '../src/packs/ca-gst-hst/index.ts';
import { parseJsonInvoice } from '../src/parsers/json.ts';
import { all, check, findings } from './helpers/ca.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures');

interface Expectation {
  findings: string[];
  infos?: string[];
  tier?: number;
}

interface Fixture {
  name: string;
  raw: string;
  expect: Expectation;
}

function loadDir(dir: 'valid' | 'invalid'): Fixture[] {
  return readdirSync(join(FIXTURES, dir))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const raw = readFileSync(join(FIXTURES, dir, file), 'utf8');
      const doc = JSON.parse(raw) as { $expect?: Expectation };
      if (dir === 'invalid' && doc.$expect === undefined) {
        throw new Error(`${file}: invalid fixtures need an "$expect" block`);
      }
      return { name: `${dir}/${file}`, raw, expect: doc.$expect ?? { findings: [] } };
    });
}

const valid = loadDir('valid');
const invalid = loadDir('invalid');
const reports = new Map<string, ValidationReport>();
const reportFor = (f: Fixture): ValidationReport => {
  let report = reports.get(f.name);
  if (!report) {
    report = check(f.raw);
    reports.set(f.name, report);
  }
  return report;
};

function assertExpectation(f: Fixture): void {
  const report = reportFor(f);
  expect(
    report.errors.filter((i) => i.ruleId.startsWith('PARSE-')),
    'parse errors',
  ).toEqual([]);
  expect(findings(report)).toEqual([...new Set(f.expect.findings)].sort());
  const infoIds = report.infos.map((i) => i.ruleId);
  for (const id of f.expect.infos ?? []) expect(infoIds, `info ${id}`).toContain(id);
  if (f.expect.tier !== undefined) expect(report.tier).toBe(f.expect.tier);
}

describe('invalid fixtures (each asserts its exact rule IDs)', () => {
  it('has at least 15 cases', () => {
    expect(invalid.length).toBeGreaterThanOrEqual(15);
  });

  it.each(invalid.map((f) => [f.name, f] as const))('%s', (_name, f) => {
    assertExpectation(f);
  });
});

describe('valid fixtures', () => {
  it.each(valid.map((f) => [f.name, f] as const))('%s is ok with zero warnings', (_name, f) => {
    assertExpectation(f);
    const report = reportFor(f);
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it.each([
    ['valid/tier1-ab-receipt-45.json', 1],
    ['valid/tier2-on-invoice-250.json', 2],
    ['valid/tier3-bc-invoice-1200.json', 3],
  ])('%s is tier %d', (name, tier) => {
    const f = valid.find((v) => v.name === name);
    expect(f, name).toBeDefined();
    if (f) expect(reportFor(f).tier).toBe(tier);
  });

  it.each(valid.map((f) => [f.name, f] as const))('%s adds up exactly', (_name, f) => {
    const parsed = parseJsonInvoice(f.raw);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.parseErrors));
    const inv = parsed.invoice;
    for (const line of inv.lines) {
      if (line.unitPrice !== undefined && line.quantity !== undefined) {
        expect(multiplyCents(line.unitPrice, line.quantity)).toBe(line.lineTotal);
      }
    }
    expect(inv.lines.reduce((s, l) => s + l.lineTotal, 0)).toBe(inv.subtotal);
    for (const tax of inv.taxes) {
      expect(percentOf(tax.taxableAmount ?? 0, tax.rate ?? '0')).toBe(tax.amount);
    }
    expect((inv.subtotal ?? 0) + inv.taxes.reduce((s, t) => s + t.amount, 0)).toBe(inv.total);
  });
});

describe('rule coverage', () => {
  it('every ca-gst-hst rule ID is produced by at least one fixture', () => {
    const produced = new Set(
      [...valid, ...invalid].flatMap((f) => all(reportFor(f)).map((i) => i.ruleId)),
    );
    const missing = caGstHstPack.rules.map((r) => r.id).filter((id) => !produced.has(id));
    expect(missing).toEqual([]);
  });

  it('every rule ID is unique', () => {
    const ids = caGstHstPack.rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
