/**
 * Keeps the documentation honest: examples must be real output, links must
 * point at files that exist, and counts must match the code.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type CliIo, nodeIo, runCli } from '../src/cli/app.ts';
import { validate } from '../src/index.ts';
import type { JsonOutput } from '../src/output.ts';
import { caGstHstPack } from '../src/packs/ca-gst-hst/index.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const codeBlock = (markdown: string, lang: string): string | undefined =>
  new RegExp(`\`\`\`${lang}\\n([\\s\\S]*?)\`\`\``).exec(markdown)?.[1];

describe('README', () => {
  it('the sample JSON report is real CLI output for test/fixtures/invalid/06', async () => {
    const readme = read('README.md');
    const outputSection = readme.slice(readme.indexOf('## Output'));
    const sample = codeBlock(outputSection, 'json');
    expect(sample).toBeDefined();

    let stdout = '';
    const fixture = await readFile(
      join(ROOT, 'test/fixtures/invalid/06-registration-number-typo.json'),
    );
    const io: CliIo = {
      ...nodeIo(),
      stdout: (t) => (stdout += t),
      stderr: () => undefined,
      readFile: async (p) => (p === 'invoice.json' ? fixture : readFile(p)),
      exists: (p) => Promise.resolve(p === 'invoice.json'),
    };
    await runCli(['check', '--format', 'json', 'invoice.json'], io);
    // Everything but the tool's version, which changes with every release (release-please
    // can't bump it here: the JSON block has no room for its marker comment).
    const shown = JSON.parse(sample ?? '') as JsonOutput;
    const actual = JSON.parse(stdout) as JsonOutput;
    expect(shown.tool.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect({ ...shown, tool: { ...shown.tool, version: actual.tool.version } }).toEqual(actual);
  });

  it('shows the demo GIF', () => {
    expect(read('README.md')).toContain('](./docs/demo.gif)');
    expect(existsSync(join(ROOT, 'docs/demo.gif'))).toBe(true);
  });
});

describe('docs/inputs.md', () => {
  it('the UBL example is a valid tier-2 invoice with no findings', () => {
    const xml = codeBlock(read('docs/inputs.md'), 'xml');
    expect(xml).toBeDefined();
    const r = validate(xml ?? '');
    expect(r).toMatchObject({ ok: true, format: 'ubl', tier: 2, errors: [], warnings: [] });
    expect(r.infos.filter((i) => i.ruleId.startsWith('PARSE'))).toEqual([]);
  });

  it('the JSON example is valid with no findings', () => {
    const json = codeBlock(read('docs/inputs.md'), 'json');
    const r = validate(json ?? '');
    expect(r).toMatchObject({ ok: true, format: 'json', errors: [], warnings: [] });
  });
});

describe('CHANGELOG', () => {
  it('states the real number of rules', () => {
    expect(read('CHANGELOG.md')).toContain(`${caGstHstPack.rules.length} rules`);
  });
});

describe('relative links in Markdown', () => {
  const files = [
    'README.md',
    'CONTRIBUTING.md',
    'CHANGELOG.md',
    ...readdirSync(join(ROOT, 'docs'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => `docs/${f}`),
  ];

  it.each(files)('%s', (file) => {
    const text = read(file);
    const broken: string[] = [];
    for (const [, target = ''] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const path = target.split('#')[0] ?? '';
      if (!existsSync(resolve(dirname(join(ROOT, file)), path))) broken.push(target);
    }
    expect(broken).toEqual([]);
  });
});
