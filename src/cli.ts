import { Command, CommanderError } from 'commander';
import { VERSION } from './index.ts';

/** Exit codes: 0 = no issues, 1 = issues found, 2 = usage error. */
export const EXIT = { OK: 0, ISSUES: 1, USAGE: 2 } as const;

function buildProgram(): Command {
  const program = new Command();

  program
    .name('invoicelint')
    .description('Check invoices for tax-compliance requirements (Canada GST/HST first).')
    .version(VERSION)
    // Commander exits with 1 on bad usage by default; we reserve 1 for "issues found".
    .exitOverride();

  program
    .command('check')
    .description('Validate one or more invoice files')
    .argument('<file...>', 'invoice files (JSON or UBL 2.1 XML)')
    .option('-f, --format <format>', 'output format: pretty | json', 'pretty')
    .option('-p, --pack <id...>', 'rule packs to run (default: all applicable)')
    .action(() => {
      process.stderr.write('invoicelint: `check` is not implemented yet.\n');
      process.exitCode = EXIT.USAGE;
    });

  return program;
}

try {
  await buildProgram().parseAsync(process.argv);
} catch (err) {
  if (err instanceof CommanderError) {
    // --help and --version surface as CommanderError with exitCode 0.
    process.exitCode = err.exitCode === 0 ? EXIT.OK : EXIT.USAGE;
  } else {
    throw err;
  }
}
