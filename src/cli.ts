/** Executable entry point for the `invoicelint` command. */
import { runCli } from './cli/app.ts';

process.exitCode = await runCli(process.argv.slice(2));
