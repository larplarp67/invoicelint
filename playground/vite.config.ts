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

export default defineConfig({
  plugins: [
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
  build: {
    target: 'es2022',
  },
});
