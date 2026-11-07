/**
 * The `invoicelint` command line, as a function so it can be tested without
 * spawning processes. src/cli.ts is the thin executable entry point.
 */
import { readFile } from 'node:fs/promises';
import { Command, CommanderError, Option } from 'commander';
import type { ValidationReport } from '../engine.ts';
import { VERSION, validate } from '../index.ts';
import type { Issue } from '../types.ts';

/** Exit codes: 0 = no errors, 1 = errors found, 2 = usage error. */
export const EXIT = { OK: 0, ISSUES: 1, USAGE: 2 } as const;

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  readFile: (path: string) => Promise<string>;
}

export const nodeIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readFile: (path) => readFile(path, 'utf8'),
};

interface CheckOptions {
  format: 'pretty' | 'json';
  formatIn: 'auto' | 'json' | 'ubl';
  pack?: string[];
}

interface FileResult {
  file: string;
  report: ValidationReport;
}

const LABEL: Record<Issue['severity'], string> = {
  error: 'ERROR',
  warning: 'WARN ',
  info: 'info ',
};

function pretty(results: readonly FileResult[]): string {
  const out: string[] = [];
  for (const { file, report } of results) {
    const counts = `${report.errors.length} error(s), ${report.warnings.length} warning(s)`;
    const tier = report.tier === undefined ? '' : ` · tier ${report.tier}`;
    const format = report.format === undefined ? '' : ` (${report.format.toUpperCase()})`;
    out.push(`${file}${format}: ${report.ok ? 'PASS' : 'FAIL'}${tier} · ${counts}`);
    for (const issue of [...report.errors, ...report.warnings, ...report.infos]) {
      const field = issue.field === '' ? '' : `  [${issue.field}]`;
      out.push(`  ${LABEL[issue.severity]} ${issue.ruleId}${field}`);
      out.push(`         ${issue.message}`);
      if (issue.severity !== 'info') {
        if (issue.fix !== undefined) out.push(`         Fix: ${issue.fix}`);
        if (issue.citation !== undefined) out.push(`         Source: ${issue.citation}`);
      }
    }
    if (report.packs.length === 0) out.push('  (no rule packs ran)');
    out.push('');
  }
  return `${out.join('\n')}\n`;
}

async function check(files: string[], opts: CheckOptions, io: CliIo): Promise<number> {
  const results: FileResult[] = [];
  let usageError = false;
  for (const file of files) {
    let text: string;
    try {
      text = await io.readFile(file);
    } catch (err) {
      io.stderr(
        `invoicelint: cannot read ${file}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      usageError = true;
      continue;
    }
    try {
      const report = validate(text, {
        format: opts.formatIn,
        ...(opts.pack ? { packs: opts.pack } : {}),
      });
      results.push({ file, report });
    } catch (err) {
      // Programmer/usage errors from validate(): unknown pack, bad options.
      io.stderr(`invoicelint: ${err instanceof Error ? err.message : String(err)}\n`);
      return EXIT.USAGE;
    }
  }

  if (opts.format === 'json') {
    io.stdout(`${JSON.stringify({ version: VERSION, files: results }, null, 2)}\n`);
  } else if (results.length > 0) {
    io.stdout(pretty(results));
  }
  if (usageError) return EXIT.USAGE;
  return results.every((r) => r.report.ok) ? EXIT.OK : EXIT.ISSUES;
}

/** Run the CLI with the given arguments (without "node" and the script path). */
export async function runCli(args: readonly string[], io: CliIo = nodeIo): Promise<number> {
  let exitCode: number = EXIT.OK;
  const program = new Command()
    .name('invoicelint')
    .description('Check invoices for Canadian GST/HST input tax credit requirements and tax math.')
    .version(VERSION)
    .exitOverride()
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr });

  program
    .command('check')
    .description('Check one or more invoice files (JSON or UBL 2.1 XML)')
    .argument('<file...>', 'invoice files')
    .addOption(
      new Option('-f, --format <format>', 'output format')
        .choices(['pretty', 'json'])
        .default('pretty'),
    )
    .addOption(
      new Option('--format-in <format>', 'input format (auto: XML if the file starts with "<")')
        .choices(['auto', 'json', 'ubl'])
        .default('auto'),
    )
    // One ID per flag (repeatable, or comma-separated). A variadic <id...> would
    // swallow the file names that follow it.
    .option(
      '-p, --pack <id>',
      'rule pack to run; repeat or comma-separate for several (default: all that apply)',
      (value: string, previous: string[] | undefined) => [
        ...(previous ?? []),
        ...value
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s !== ''),
      ],
    )
    .exitOverride()
    .action(async (files: string[], opts: CheckOptions) => {
      exitCode = await check(files, opts, io);
    });

  try {
    await program.parseAsync([...args], { from: 'user' });
  } catch (err) {
    if (err instanceof CommanderError) {
      // --help and --version surface as CommanderError with exitCode 0.
      return err.exitCode === 0 ? EXIT.OK : EXIT.USAGE;
    }
    throw err;
  }
  return exitCode;
}
