/** Executable entry point for the `invoicelint` command. */
import { nodeIo, runCli } from './cli/app.ts';

process.exitCode = await runCli(process.argv.slice(2), nodeIo());
