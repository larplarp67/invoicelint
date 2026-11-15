import { defineConfig } from 'vite';

/**
 * The built page may load its own files and nothing else: no fetch, no
 * WebSocket, no form posts, no third-party scripts or fonts. This backs the
 * promise that the invoice never leaves the page. Build only, because the dev
 * server needs a WebSocket for hot reload.
 */
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** src/csp.ts, which main.ts imports first only for what it does on load. */
const CSP_MODULE = /[\\/]playground[\\/]src[\\/]csp\.ts$/;

export default defineConfig({
  plugins: [
    {
      // The root package.json says "sideEffects": false (true of the library),
      // which would let the bundler drop `import './csp.ts'`. Marking just this
      // module here takes precedence over package.json and touches nothing else.
      name: 'invoicelint-keep-csp-module',
      apply: 'build',
      transform(code, id) {
        return CSP_MODULE.test(id) ? { code, map: null, moduleSideEffects: true } : null;
      },
    },
    {
      name: 'invoicelint-csp',
      apply: 'build',
      transformIndexHtml: (html) =>
        html.replace(
          '<meta charset="utf-8" />',
          `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
        ),
    },
  ],
  // GitHub Pages serves the repo's site at https://larplarp67.github.io/invoicelint/.
  // The dev and preview servers use the same path.
  base: '/invoicelint/',
  build: {
    target: 'es2022',
  },
});
