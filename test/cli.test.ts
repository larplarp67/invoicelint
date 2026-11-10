import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type CliIo, EXIT, nodeIo, runCli, useColor } from '../src/cli/app.ts';
import { detectFormat, validate } from '../src/index.ts';
import type { JsonOutput } from '../src/output.ts';
import { renderPretty } from '../src/cli/pretty.ts';
import { buildUbl, caTier2 } from './helpers/ubl.ts';

// Relative paths keep snapshots identical on every OS (vitest runs from the repo root).
const PASSING = 'test/fixtures/valid/tier2-on-invoice-250.json';
const FAILING = 'test/fixtures/invalid/06-registration-number-typo.json';
const WARNING = 'test/fixtures/invalid/21-bare-business-number.json';
const CREDIT_NOTE_FILE = 'test/fixtures/eu/fr-credit-note.xml';
const FIXTURES = join(import.meta.dirname, 'fixtures');
const CREDIT_NOTE = buildUbl({ ...caTier2, root: 'CreditNote' });

/** In-memory IO: virtual files first, then the real disk. No colours, fixed width, a TTY. */
function memoryIo(files: Record<string, string | Uint8Array> = {}, overrides: Partial<CliIo> = {}) {
  let stdout = '';
  let stderr = '';
  const real = nodeIo();
  const io: CliIo = {
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
    readFile: async (p) => {
      const f = files[p];
      if (f === undefined) return readFile(p);
      return typeof f === 'string' ? new TextEncoder().encode(f) : f;
    },
    exists: async (p) => p in files || (await real.exists(p)),
    glob: real.glob,
    isTTY: true,
    color: false,
    columns: 100,
    ...overrides,
  };
  return { io, out: () => stdout, err: () => stderr };
}

async function run(
  args: string[],
  files?: Record<string, string | Uint8Array>,
  overrides?: Partial<CliIo>,
) {
  const m = memoryIo(files, overrides);
  const code = await runCli(args, m.io);
  return { code, out: m.out(), err: m.err() };
}

const json = (out: string) => JSON.parse(out) as JsonOutput;
const lastLine = (out: string) => out.trimEnd().split('\n').at(-1);

describe('snapshots (colours off)', () => {
  it('pretty: passing invoice', async () => {
    const r = await run(['check', PASSING]);
    expect(r.code).toBe(EXIT.OK);
    expect(r.out).toMatchSnapshot();
  });

  it('pretty: failing invoice', async () => {
    const r = await run(['check', FAILING]);
    expect(r.code).toBe(EXIT.ISSUES);
    expect(r.out).toMatchSnapshot();
  });

  it('json: passing invoice', async () => {
    expect((await run(['check', '--format', 'json', PASSING])).out).toMatchSnapshot();
  });

  it('json: failing invoice', async () => {
    expect((await run(['check', '--format', 'json', FAILING])).out).toMatchSnapshot();
  });

  it('pretty: credit note (skipped)', async () => {
    const r = await run(['check', CREDIT_NOTE_FILE]);
    expect(r.code).toBe(EXIT.OK);
    expect(r.out).toMatchSnapshot();
  });

  it('json: credit note (skipped)', async () => {
    expect((await run(['check', '--format', 'json', CREDIT_NOTE_FILE])).out).toMatchSnapshot();
  });
});

describe('pretty output', () => {
  it('has a header per file and a summary line across files', async () => {
    const r = await run(['check', PASSING, FAILING, WARNING]);
    expect(r.out).toContain(`${PASSING}  JSON · tier 2 · ✓ OK`);
    expect(r.out).toContain(`${FAILING}  JSON · tier 2 · ✗ 1 error, 0 warnings`);
    expect(r.out).toContain(`${WARNING}  JSON · tier 2 · ✓ OK · 1 warning`);
    expect(lastLine(r.out)).toBe('3 files · 1 failed · 1 warning');
  });

  it('groups by severity, with field label, fix and citation', async () => {
    const r = await run(['check', FAILING]);
    expect(r.out).toContain('  Errors (1)\n  ✗ CA-BN-001  Supplier GST/HST number\n');
    expect(r.out).toContain('    Fix: Compare the number');
    expect(r.out).toContain('    SOR/91-45 s.3(b)(i)');
  });

  it('hides info unless --verbose', async () => {
    expect((await run(['check', PASSING])).out).not.toContain('CA-TIER-001');
    const verbose = await run(['check', '--verbose', PASSING]);
    expect(verbose.out).toContain('  Info (1)');
    expect(verbose.out).toContain('ℹ CA-TIER-001  Total');
  });

  it('--quiet prints only the summary line', async () => {
    const r = await run(['check', '--quiet', PASSING, FAILING]);
    expect(r.out).toBe('2 files · 1 failed · 0 warnings\n');
  });

  it('marks --strict failures and says so in the summary', async () => {
    const r = await run(['check', '--strict', WARNING]);
    expect(r.out).toContain('✗ 0 errors, 1 warning (strict)');
    expect(lastLine(r.out)).toBe('1 file · 1 failed · 1 warning · strict');
  });

  it('shows a credit note as SKIPPED with the reason, never as OK', async () => {
    const r = await run(['check', 'cn.xml'], { 'cn.xml': CREDIT_NOTE });
    expect(r.out).toContain('cn.xml  UBL · ⊘ SKIPPED — credit note (not checked yet)');
    expect(r.out).not.toContain('✓');
    expect(r.out).not.toContain('PARSE-UBL-010'); // the header says why; --verbose shows the note
    expect(lastLine(r.out)).toBe('1 file · 0 failed · 1 skipped · 0 warnings');
    const verbose = await run(['check', '--verbose', 'cn.xml'], { 'cn.xml': CREDIT_NOTE });
    expect(verbose.out).toContain('PARSE-UBL-010');
  });

  it('shows SKIPPED in a neutral (dim) colour, not green', async () => {
    const r = await run(['check', 'cn.xml'], { 'cn.xml': CREDIT_NOTE }, { color: true });
    expect(r.out).toContain('\u001b[2m⊘ SKIPPED — credit note (not checked yet)\u001b[22m');
    expect(r.out).not.toContain('\u001b[32m');
  });

  it('counts skipped files separately in the summary line', async () => {
    const r = await run(['check', WARNING, FAILING, 'cn.xml'], { 'cn.xml': CREDIT_NOTE });
    expect(lastLine(r.out)).toBe('3 files · 1 failed · 1 skipped · 1 warning');
  });

  it('shows the notes of a skipped file when the header cannot name the reason', () => {
    const note = { ruleId: 'X-001', severity: 'info' as const, field: '', message: 'Why.' };
    const out = renderPretty(
      [{ file: 'x.xml', report: { ok: true, packs: [], errors: [], warnings: [], infos: [note] } }],
      { color: false, width: 100 },
    );
    expect(out.split('\n')[0]).toBe('x.xml  ⊘ SKIPPED');
    expect(out).toContain('X-001');
  });

  it('shows input errors as such', async () => {
    const r = await run(['check', 'missing.json']);
    expect(r.out).toContain('missing.json  ✗ input error');
    expect(r.out).toContain('INPUT-001');
    expect(r.out).toContain('1 input error');
  });

  it('uses colours only when asked', async () => {
    const plain = await run(['check', FAILING]);
    expect(plain.out).not.toContain('\u001b[');
    const colored = await run(['check', FAILING], {}, { color: true });
    expect(colored.out).toContain('\u001b[31m✗');
  });
});

describe('useColor (NO_COLOR / FORCE_COLOR)', () => {
  it.each<[Record<string, string>, boolean, boolean]>([
    [{}, true, true],
    [{}, false, false],
    [{ NO_COLOR: '1' }, true, false],
    [{ NO_COLOR: '' }, true, true], // an empty NO_COLOR is ignored, per no-color.org
    [{ FORCE_COLOR: '1' }, false, true],
    [{ FORCE_COLOR: '0' }, false, false],
    [{ NO_COLOR: '1', FORCE_COLOR: '1' }, true, false], // NO_COLOR wins
  ])('%j, tty=%s -> %s', (env, tty, expected) => {
    expect(useColor(env, tty)).toBe(expected);
  });
});

describe('format selection', () => {
  it('defaults to pretty in a terminal and JSON when piped', async () => {
    expect((await run(['check', PASSING])).out).toContain('✓ OK');
    const piped = await run(['check', PASSING], {}, { isTTY: false });
    expect(json(piped.out).schemaVersion).toBe(1);
  });

  it('--format overrides the default', async () => {
    const r = await run(['check', '--format', 'pretty', PASSING], {}, { isTTY: false });
    expect(r.out).toContain('✓ OK');
  });
});

describe('JSON output shape (documented in docs/json-output.md)', () => {
  it('has schemaVersion, tool, summary and one entry per file', async () => {
    const out = json(
      (await run(['check', '--format', 'json', PASSING, FAILING, 'missing.json'])).out,
    );
    expect(out.schemaVersion).toBe(1);
    expect(out.tool).toEqual({ name: 'invoicelint', version: '0.2.0' });
    expect(out.summary).toEqual({
      files: 3,
      passed: 1,
      failed: 1,
      skipped: 0,
      inputErrors: 1,
      errors: 2,
      warnings: 0,
      strict: false,
    });
    expect(out.files.map((f) => [f.file, f.status, f.format, f.tier])).toEqual([
      [PASSING, 'ok', 'json', 2],
      [FAILING, 'failed', 'json', 2],
      ['missing.json', 'input-error', undefined, undefined],
    ]);
    expect(out.files[2]?.errors[0]?.ruleId).toBe('INPUT-001');
    expect(Object.keys(out.files[0] ?? {})).toEqual([
      'file',
      'status',
      'format',
      'tier',
      'packs',
      'errors',
      'warnings',
      'infos',
    ]);
  });

  it('reports a credit note as skipped, even with --strict', async () => {
    for (const args of [['check'], ['check', '--strict']]) {
      const r = await run([...args, '--format', 'json', 'cn.xml'], { 'cn.xml': CREDIT_NOTE });
      const out = json(r.out);
      expect(out.files[0]?.status).toBe('skipped');
      expect(out.files[0]?.tier).toBeUndefined();
      expect(out.summary).toMatchObject({ files: 1, passed: 0, failed: 0, skipped: 1 });
      expect(r.code).toBe(EXIT.OK);
    }
  });

  it('includes infos regardless of --verbose', async () => {
    const out = json((await run(['check', '--format', 'json', PASSING])).out);
    expect(out.files[0]?.infos.map((i) => i.ruleId)).toContain('CA-TIER-001');
  });
});

describe('exit codes', () => {
  it.each<[string, string[], Record<string, string>, number]>([
    ['0: no errors', ['check', PASSING], {}, EXIT.OK],
    ['0: warnings only', ['check', WARNING], {}, EXIT.OK],
    ['1: warnings with --strict', ['check', '--strict', WARNING], {}, EXIT.ISSUES],
    ['1: errors', ['check', FAILING], {}, EXIT.ISSUES],
    ['1: errors in one of several files', ['check', PASSING, FAILING], {}, EXIT.ISSUES],
    ['0: a credit note (skipped)', ['check', 'cn.xml'], { 'cn.xml': CREDIT_NOTE }, EXIT.OK],
    [
      '0: a credit note (skipped) with --strict',
      ['check', '--strict', 'cn.xml'],
      { 'cn.xml': CREDIT_NOTE },
      EXIT.OK,
    ],
    [
      '1: errors alongside a skipped credit note',
      ['check', FAILING, 'cn.xml'],
      { 'cn.xml': CREDIT_NOTE },
      EXIT.ISSUES,
    ],
    ['2: missing file', ['check', 'missing.json'], {}, EXIT.USAGE],
    ['2: an input error beats errors', ['check', FAILING, 'missing.json'], {}, EXIT.USAGE],
    ['2: unparseable JSON', ['check', 'bad.json'], { 'bad.json': '{"total": ' }, EXIT.USAGE],
    ['2: malformed XML', ['check', 'bad.xml'], { 'bad.xml': '<Invoice><ID>' }, EXIT.USAGE],
    ['2: not an invoice', ['check', 'o.xml'], { 'o.xml': '<Order xmlns="urn:x"/>' }, EXIT.USAGE],
    [
      '2: invoice without a total',
      ['check', 't.json'],
      { 't.json': '{"issueDate":"2026-01-01"}' },
      EXIT.USAGE,
    ],
    [
      '2: undecodable encoding',
      ['check', 'x.xml'],
      { 'x.xml': '<?xml version="1.0" encoding="x-made-up"?><Invoice/>' },
      EXIT.USAGE,
    ],
    ['2: wildcard matching nothing', ['check', 'test/fixtures/nothing-*.json'], {}, EXIT.USAGE],
    ['2: no file argument', ['check'], {}, EXIT.USAGE],
    ['2: bad --format', ['check', '--format', 'xml', PASSING], {}, EXIT.USAGE],
    ['2: bad --format-in', ['check', '--format-in', 'csv', PASSING], {}, EXIT.USAGE],
    ['2: bad --rate-window-days', ['check', '--rate-window-days', 'ten', PASSING], {}, EXIT.USAGE],
    ['2: unknown pack', ['check', '--pack', 'us-dbna', PASSING], {}, EXIT.USAGE],
    ['2: unknown command', ['frobnicate'], {}, EXIT.USAGE],
    ['0: --help', ['--help'], {}, EXIT.OK],
    ['0: --version', ['--version'], {}, EXIT.OK],
    ['0: rules', ['rules'], {}, EXIT.OK],
  ])('%s', async (_label, args, files, expected) => {
    expect((await run(args, files)).code).toBe(expected);
  });
});

describe('inputs', () => {
  it('expands globs with braces, on every OS', async () => {
    const r = await run(['check', '--format', 'json', 'test/fixtures/valid/tier*.{json,xml}']);
    const names = json(r.out).files.map((f) => f.file.split(/[\\/]/).at(-1));
    expect(names).toHaveLength(6);
    expect(names).toContain('tier2-on-invoice-250.xml');
    expect(r.code).toBe(EXIT.OK);
  });

  it('expands Windows-style backslash patterns', async () => {
    const r = await run(['check', '--format', 'json', join(FIXTURES, 'valid', 'tier*.xml')]);
    expect(json(r.out).files).toHaveLength(3);
  });

  it('a file whose name contains wildcard characters is read as written', async () => {
    const r = await run(['check', 'invoice[1].json'], {
      'invoice[1].json': '{"total": "10.00", "supplier": {"name": "S"}, "issueDate": "2026-01-02"}',
    });
    expect(r.code).toBe(EXIT.OK);
  });

  it('reads UTF-16 (Windows PowerShell 5.1) and declared XML encodings', async () => {
    const text = await readFile(PASSING, 'utf8');
    const utf16le = new Uint8Array([0xff, 0xfe, ...new Uint8Array(Buffer.from(text, 'utf16le'))]);
    const latin1 = buildUbl({
      ...caTier2,
      seller: { ...caTier2.seller, tradingName: 'Imprimerie Érable Ltée' },
    }).replace('UTF-8', 'ISO-8859-1');
    const r = await run(['check', '--format', 'json', 'utf16.json', 'latin1.xml'], {
      'utf16.json': utf16le,
      'latin1.xml': new Uint8Array(Buffer.from(latin1, 'latin1')),
    });
    expect(json(r.out).files.map((f) => [f.format, f.status])).toEqual([
      ['json', 'ok'],
      ['ubl', 'ok'],
    ]);
  });

  it('--format-in overrides detection', async () => {
    const r = await run(['check', '--format', 'json', '--format-in', 'ubl', PASSING]);
    expect(json(r.out).files[0]?.errors[0]?.ruleId).toBe('PARSE-UBL-002');
    expect(r.code).toBe(EXIT.USAGE);
  });

  it('--pack takes one ID per flag, so it does not swallow the files', async () => {
    expect((await run(['check', '--pack', 'ca-gst-hst', PASSING])).code).toBe(EXIT.OK);
    expect((await run(['check', '-p', 'ca-gst-hst,ca-gst-hst', PASSING])).code).toBe(EXIT.OK);
  });

  it('--rate-window-days changes the transition window', async () => {
    const near = 'test/fixtures/invalid/22-hst-14-near-nova-scotia-change.json';
    expect((await run(['check', near])).code).toBe(EXIT.OK); // a warning only
    expect((await run(['check', '--rate-window-days', '0', near])).code).toBe(EXIT.ISSUES);
  });

  it('reports an unmatched wildcard on stderr', async () => {
    expect((await run(['check', 'test/fixtures/nothing-*.json'])).err).toContain('no files match');
  });

  it('reports an unknown pack on stderr', async () => {
    expect((await run(['check', '--pack', 'us-dbna', PASSING])).err).toContain(
      'Unknown rule pack "us-dbna"',
    );
  });
});

describe('other commands', () => {
  it('rules lists every rule with severity and tier', async () => {
    const r = await run(['rules']);
    expect(r.out.split('\n')[0]).toMatch(/^ID\s+SEVERITY\s+TIER\s+CHECKS$/);
    expect(r.out).toMatch(
      /CA-ITC-010\s+warning\s+2\+\s+Supplier's \(or intermediary's\) GST\/HST number/,
    );
    expect(r.out).toMatch(/CA-BN-003\s+warning\s+2\+/);
    expect(r.out).toContain('docs/rules.md');
  });

  it('--help shows examples and exit codes', async () => {
    const r = await run(['--help']);
    expect(r.out).toContain('Examples:');
    expect(r.out).toContain('invoicelint check "invoices/**/*.{json,xml}"');
    expect(r.out).toContain('Exit codes: 0 ok · 1 issues found · 2 usage or input error');
  });

  it('--version prints the package version', async () => {
    expect((await run(['--version'])).out.trim()).toBe('0.2.0');
  });
});

describe('library helpers used by the CLI', () => {
  it.each([
    ['<Invoice/>', 'ubl'],
    ['  \n\t<?xml version="1.0"?><Invoice/>', 'ubl'],
    [`${String.fromCharCode(0xfeff)}<Invoice/>`, 'ubl'],
    ['{"total": 1}', 'json'],
    ['', 'json'],
  ])('detectFormat(%j) -> %s', (input, expected) => {
    expect(detectFormat(input)).toBe(expected);
  });

  it('validate() auto-detects UBL', () => {
    expect(validate(buildUbl(caTier2))).toMatchObject({ ok: true, format: 'ubl', tier: 2 });
  });
});
