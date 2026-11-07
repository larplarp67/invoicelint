import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type CliIo, EXIT, runCli } from '../src/cli/app.ts';
import { detectFormat, validate } from '../src/index.ts';
import { buildUbl, caTier2 } from './helpers/ubl.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures');

/** In-memory IO: virtual files first, then the real disk. */
function memoryIo(files: Record<string, string> = {}) {
  let stdout = '';
  let stderr = '';
  const io: CliIo = {
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
    readFile: async (p) => files[p] ?? (await readFile(p, 'utf8')),
  };
  return { io, out: () => stdout, err: () => stderr };
}

const tier2Json = join(FIXTURES, 'valid', 'tier2-on-invoice-250.json');
const bnTypoJson = join(FIXTURES, 'invalid', '06-registration-number-typo.json');

describe('detectFormat', () => {
  it.each([
    ['<Invoice/>', 'ubl'],
    ['  \n\t<?xml version="1.0"?><Invoice/>', 'ubl'],
    [`${String.fromCharCode(0xfeff)}<Invoice/>`, 'ubl'],
    ['{"total": 1}', 'json'],
    [' {"total": 1}', 'json'],
    ['', 'json'],
  ])('%j -> %s', (input, expected) => {
    expect(detectFormat(input)).toBe(expected);
  });

  it('treats objects as JSON', () => {
    expect(detectFormat({ total: 1 })).toBe('json');
  });
});

describe('validate() with UBL', () => {
  it('auto-detects XML and reports the format', () => {
    const report = validate(buildUbl(caTier2));
    expect(report).toMatchObject({ ok: true, format: 'ubl', tier: 2 });
    expect(report.warnings).toEqual([]);
  });

  it('puts parse notes first, in the right buckets', () => {
    const xml = buildUbl({
      ...caTier2,
      lines: [{ name: 'Consulting', amount: '221.24', category: 'AE' }],
    });
    const report = validate(xml);
    expect(report.infos[0]?.ruleId).toBe('PARSE-UBL-020');
    expect(report.ok).toBe(true);
  });

  it('a parse error that does not stop parsing still fails the report', () => {
    const report = validate(buildUbl({ ...caTier2, id: null }));
    expect(report.ok).toBe(false);
    expect(report.errors.map((i) => i.ruleId)).toEqual(['PARSE-UBL-031']);
    expect(report.packs).toHaveLength(1); // the rules still ran
  });

  it('a credit note is ok, with no packs run', () => {
    const report = validate(buildUbl({ ...caTier2, root: 'CreditNote' }));
    expect(report).toMatchObject({ ok: true, packs: [], format: 'ubl' });
    expect(report.infos.map((i) => i.ruleId)).toEqual(['PARSE-UBL-010']);
  });

  it('honours an explicit format', () => {
    expect(validate('{"total": 1}', { format: 'ubl' }).errors[0]?.ruleId).toBe('PARSE-UBL-002');
    expect(validate(buildUbl(caTier2), { format: 'json' }).errors[0]?.ruleId).toBe('PARSE-001');
  });

  it('passes the XML size limit through', () => {
    expect(validate(buildUbl(caTier2), { maxXmlBytes: 50 }).errors[0]?.ruleId).toBe(
      'PARSE-UBL-004',
    );
  });

  it('rejects bad options (programmer errors)', () => {
    // @ts-expect-error -- deliberately invalid
    expect(() => validate('{}', { format: 'csv' })).toThrow(RangeError);
    expect(() => validate({ total: 1 }, { format: 'ubl' })).toThrow(TypeError);
  });
});

describe('invoicelint CLI', () => {
  it('passes a valid JSON invoice (exit 0)', async () => {
    const m = memoryIo();
    expect(await runCli(['check', tier2Json], m.io)).toBe(EXIT.OK);
    expect(m.out()).toContain('(JSON): PASS · tier 2');
  });

  it('passes a valid UBL invoice (exit 0)', async () => {
    const m = memoryIo({ 'tier2.xml': buildUbl(caTier2) });
    expect(await runCli(['check', 'tier2.xml'], m.io)).toBe(EXIT.OK);
    expect(m.out()).toContain('tier2.xml (UBL): PASS · tier 2');
  });

  it('exits 1 when any file has errors, and shows fix and source', async () => {
    const m = memoryIo();
    expect(await runCli(['check', tier2Json, bnTypoJson], m.io)).toBe(EXIT.ISSUES);
    expect(m.out()).toContain('ERROR CA-BN-001  [supplier.gstHstNumber]');
    expect(m.out()).toContain('Source: SOR/91-45 s.3(b)(i)');
  });

  it('warnings alone do not fail (exit 0)', async () => {
    const m = memoryIo({
      'no-bn.json': JSON.stringify({
        issueDate: '2026-04-02',
        supplier: { name: 'S' },
        total: '250.00',
      }),
    });
    expect(await runCli(['check', 'no-bn.json'], m.io)).toBe(EXIT.OK);
    expect(m.out()).toContain('WARN  CA-ITC-010');
  });

  it('emits machine-readable JSON with --format json', async () => {
    const m = memoryIo({ 'tier2.xml': buildUbl(caTier2) });
    expect(await runCli(['check', '--format', 'json', tier2Json, 'tier2.xml'], m.io)).toBe(EXIT.OK);
    const parsed = JSON.parse(m.out()) as {
      files: { file: string; report: { format: string; tier: number } }[];
    };
    expect(parsed.files.map((f) => [f.report.format, f.report.tier])).toEqual([
      ['json', 2],
      ['ubl', 2],
    ]);
  });

  it('--format-in overrides detection', async () => {
    const m = memoryIo();
    expect(await runCli(['check', '--format-in', 'ubl', tier2Json], m.io)).toBe(EXIT.ISSUES);
    expect(m.out()).toContain('PARSE-UBL-002');
  });

  it('reports a credit note without failing', async () => {
    const m = memoryIo({ 'cn.xml': buildUbl({ ...caTier2, root: 'CreditNote' }) });
    expect(await runCli(['check', 'cn.xml'], m.io)).toBe(EXIT.OK);
    expect(m.out()).toContain('PARSE-UBL-010');
    expect(m.out()).toContain('(no rule packs ran)');
  });

  it.each([
    [['check'], 'missing file argument'],
    [['check', '--format', 'xml', 'x.json'], 'bad --format value'],
    [['check', '--format-in', 'csv', 'x.json'], 'bad --format-in value'],
    [['frobnicate'], 'unknown command'],
  ])('exits 2 on usage errors: %j (%s)', async (args) => {
    const m = memoryIo();
    expect(await runCli(args, m.io)).toBe(EXIT.USAGE);
  });

  it('exits 2 for an unreadable file, after checking the others', async () => {
    const m = memoryIo();
    expect(await runCli(['check', 'does-not-exist.json', tier2Json], m.io)).toBe(EXIT.USAGE);
    expect(m.err()).toContain('cannot read does-not-exist.json');
    expect(m.out()).toContain('PASS');
  });

  it('--pack takes one ID per flag, so it does not swallow the files', async () => {
    const m = memoryIo();
    expect(await runCli(['check', '--pack', 'ca-gst-hst', tier2Json], m.io)).toBe(EXIT.OK);
    expect(m.out()).toContain('PASS');
    const m2 = memoryIo();
    expect(await runCli(['check', '-p', 'ca-gst-hst,ca-gst-hst', tier2Json], m2.io)).toBe(EXIT.OK);
  });

  it('exits 2 for an unknown pack', async () => {
    const m = memoryIo();
    expect(await runCli(['check', '--pack', 'us-dbna', tier2Json], m.io)).toBe(EXIT.USAGE);
    expect(m.err()).toContain('Unknown rule pack "us-dbna"');
  });

  it('prints the version (exit 0)', async () => {
    const m = memoryIo();
    expect(await runCli(['--version'], m.io)).toBe(EXIT.OK);
    expect(m.out().trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
