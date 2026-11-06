import { defineConfig } from 'tsup';

export default defineConfig([
  {
    // Library: platform-neutral so the core runs in browsers as well as Node.
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    platform: 'neutral',
    target: 'es2022',
    dts: true,
    sourcemap: true,
  },
  {
    // CLI: Node-only entry point.
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    platform: 'node',
    target: 'node22',
    sourcemap: true,
    banner: { js: '#!/usr/bin/env node' },
  },
]);
