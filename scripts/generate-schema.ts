/**
 * Writes schema/invoice.schema.json from the zod model.
 * Run with `pnpm schema` (Node >= 22.18 runs TypeScript directly).
 * A test fails if the committed file is out of date.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { invoiceJsonSchema } from '../src/model.ts';

export const SCHEMA_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../schema/invoice.schema.json',
);

export function renderSchema(): string {
  return `${JSON.stringify(invoiceJsonSchema(), null, 2)}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(dirname(SCHEMA_PATH), { recursive: true });
  writeFileSync(SCHEMA_PATH, renderSchema());
  console.log(`wrote ${SCHEMA_PATH}`);
}
