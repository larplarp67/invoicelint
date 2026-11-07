import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type CliIo, EXIT, nodeIo, runCli } from '../src/cli/app.ts';
import { detectFormat, validate } from '../src/index.ts';
import { buildUbl, caTier2 } from './helpers/ubl.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures');

/** In-memory IO: virtual files first, then the real disk. */
function memoryIo(files: Record<string, string | Uint8Array> = {}) {
  let stdout = '';
  let stderr = '';
  const io: CliIo = {
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
    readFile: async (p) => {
      const f = files[p];
      if (f === undefined) return readFile(p);
      return typeof f === 'string' ? new TextEncoder().encode(f) : f;
    },
    exists: async (p) => p in files || (await nodeIo.exists(p)),
    glob: nodeIo.glob,
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
    expect(m.out()).toContain('cn.xml (UBL): NOT CHECKED');
    expect(m.out()).not.toContain('PASS');
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

  it('expands wildcards itself (Windows shells do not), with / or \\ separators', async () => {
    const m = memoryIo();
    const pattern = join(FIXTURES, 'valid', 'tier*.xml');
    expect(await runCli(['check', '--format', 'json', pattern], m.io)).toBe(EXIT.OK);
    const parsed = JSON.parse(m.out()) as { files: { file: string }[] };
    expect(parsed.files.map((f) => f.file.split(/[\\/]/).at(-1))).toEqual([
      'tier1-ab-receipt-45.xml',
      'tier2-on-invoice-250.xml',
      'tier3-bc-invoice-1200.xml',
    ]);
    const m2 = memoryIo();
    const forward = `${FIXTURES.split('\\').join('/')}/valid/tier*.json`;
    expect(await runCli(['check', forward], m2.io)).toBe(EXIT.OK);
    expect(m2.out().match(/PASS/g)).toHaveLength(3);
  });

  it('exits 2 when a wildcard matches nothing', async () => {
    const m = memoryIo();
    expect(await runCli(['check', join(FIXTURES, 'nothing-*.json')], m.io)).toBe(EXIT.USAGE);
    expect(m.err()).toContain('no files match');
  });

  it('a file whose name contains wildcard characters is read as written', async () => {
    const m = memoryIo({
      'invoice[1].json': '{"total": "10.00", "supplier": {"name": "S"}, "issueDate": "2026-01-02"}',
    });
    expect(await runCli(['check', 'invoice[1].json'], m.io)).toBe(EXIT.OK);
  });

  it('reads UTF-16 files (Windows PowerShell 5.1 Out-File) and declared XML encodings', async () => {
    const json = await readFile(tier2Json, 'utf8');
    const utf16le = new Uint8Array([0xff, 0xfe, ...new Uint8Array(Buffer.from(json, 'utf16le'))]);
    const latin1Xml = Buffer.from(
      '<?xml version="1.0" encoding="ISO-8859-1"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"><cbc:ID>1</cbc:ID><cbc:IssueDate>2026-01-02</cbc:IssueDate><cbc:DocumentCurrencyCode>CAD</cbc:DocumentCurrencyCode><cac:AccountingSupplierParty><cac:Party><cac:PartyName><cbc:Name>Imprimerie Érable Ltée</cbc:Name></cac:PartyName></cac:Party></cac:AccountingSupplierParty><cac:LegalMonetaryTotal><cbc:TaxInclusiveAmount currencyID="CAD">10.00</cbc:TaxInclusiveAmount></cac:LegalMonetaryTotal></Invoice>',
      'latin1',
    );
    const m = memoryIo({ 'utf16.json': utf16le, 'latin1.xml': new Uint8Array(latin1Xml) });
    expect(await runCli(['check', '--format', 'json', 'utf16.json', 'latin1.xml'], m.io)).toBe(
      EXIT.OK,
    );
    const parsed = JSON.parse(m.out()) as { files: { report: { ok: boolean; format: string } }[] };
    expect(parsed.files.map((f) => [f.report.format, f.report.ok])).toEqual([
      ['json', true],
      ['ubl', true],
    ]);
  });

  it('exits 2 for an XML encoding it cannot decode', async () => {
    const m = memoryIo({ 'x.xml': '<?xml version="1.0" encoding="x-made-up"?><Invoice/>' });
    expect(await runCli(['check', 'x.xml'], m.io)).toBe(EXIT.USAGE);
    expect(m.err()).toContain('encoding "x-made-up"');
  });

  it('--rate-window-days changes the transition window', async () => {
    const near = join(FIXTURES, 'invalid', '22-hst-14-near-nova-scotia-change.json');
    const m = memoryIo();
    expect(await runCli(['check', near], m.io)).toBe(EXIT.OK); // warning only
    expect(m.out()).toContain('WARN  CA-RATE-002');
    const m0 = memoryIo();
    expect(await runCli(['check', '--rate-window-days', '0', near], m0.io)).toBe(EXIT.ISSUES);
    expect(m0.out()).toContain('ERROR CA-RATE-002');
    const bad = memoryIo();
    expect(await runCli(['check', '--rate-window-days', 'ten', near], bad.io)).toBe(EXIT.USAGE);
  });

  it('prints the version (exit 0)', async () => {
    const m = memoryIo();
    expect(await runCli(['--version'], m.io)).toBe(EXIT.OK);
    expect(m.out().trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
