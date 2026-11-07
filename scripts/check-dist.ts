/**
 * Checks the BUILT package (run after `pnpm build`):
 * 1. `import { validate } from 'invoicelint'` works in Node (package self-reference
 *    through package.json "exports"), and the type declarations exist.
 * 2. The library bundles for the browser with no Node built-ins, and runs in a
 *    sandbox with no `process`, `require` or `Buffer`.
 *
 *   pnpm check:dist
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (rel: string) => readFileSync(join(root, 'test/fixtures', rel), 'utf8');
const failures: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

// 1. Node, by package name.
// A variable specifier keeps tsc from resolving it: dist/ doesn't exist when CI typechecks.
const packageName = 'invoicelint';
const lib = (await import(packageName)) as typeof import('../src/index.ts');
const fromNode = lib.validate(fixture('valid/tier2-on-invoice-250.xml'));
check('Node: import { validate } from "invoicelint"', fromNode.ok && fromNode.format === 'ubl');
check('types: dist/index.d.ts exists', existsSync(join(root, 'dist/index.d.ts')));

// 2. Browser bundle.
const entry = `
  import { validate, decodeInvoiceBytes } from ${JSON.stringify(join(root, 'dist/index.js').replaceAll('\\', '/'))};
  const json = validate(${JSON.stringify(fixture('invalid/06-registration-number-typo.json'))});
  const xml = validate(decodeInvoiceBytes(new TextEncoder().encode(${JSON.stringify(fixture('valid/tier3-bc-invoice-1200.xml'))})).text);
  globalThis.__result = { json: json.errors.map((i) => i.ruleId), xml: [xml.ok, xml.format, xml.tier] };
`;
const result = await build({
  stdin: { contents: entry, resolveDir: root, loader: 'js' },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
  minify: true,
  logLevel: 'silent',
});
const code = result.outputFiles[0]?.text ?? '';
check(
  'browser: bundles with platform=browser',
  code.length > 0,
  `${(code.length / 1024).toFixed(0)} KB`,
);
check('browser: no node: imports in the bundle', !/["']node:/.test(code));

const sandbox: Record<string, unknown> = { TextEncoder, TextDecoder, console };
createContext(sandbox);
runInContext(code, sandbox);
const out = sandbox.__result as { json: string[]; xml: unknown[] } | undefined;
check(
  'browser: validate() runs without process/require/Buffer',
  JSON.stringify(out) === JSON.stringify({ json: ['CA-BN-001'], xml: [true, 'ubl', 3] }),
  JSON.stringify(out),
);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exitCode = 1;
}
