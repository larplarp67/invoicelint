/**
 * The page's Content-Security-Policy blocks eval. Without this, zod tries
 * `new Function` once to see whether it may compile parsers, and the browser
 * logs a CSP violation even though zod catches the error. main.ts imports
 * this first, so it runs before any other module touches zod.
 */
import * as z from 'zod';

z.config({ jitless: true });
