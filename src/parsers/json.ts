/**
 * JSON input -> canonical invoice.
 *
 * Bad user input never throws: it comes back as `parseErrors` (Issues with
 * PARSE-xxx rule IDs). Only programmer errors (wrong argument type) throw.
 */
import type { z } from 'zod';
import { type Invoice, InvoiceSchema } from '../model.ts';
import type { Issue } from '../types.ts';

export type JsonParseResult = { ok: true; invoice: Invoice } | { ok: false; parseErrors: Issue[] };

/** Parse-error rule IDs. */
export const PARSE = {
  /** The input is not valid JSON. */
  INVALID_JSON: 'PARSE-001',
  /** The top-level JSON value is not an object. */
  NOT_AN_OBJECT: 'PARSE-002',
  /** A required field is missing. */
  MISSING_FIELD: 'PARSE-003',
  /** A field has the wrong JSON type. */
  WRONG_TYPE: 'PARSE-004',
  /** A field has the right type but an invalid value (format, range, allowed values). */
  INVALID_VALUE: 'PARSE-005',
} as const;

/** ["lines", 2, "lineTotal"] -> "lines[2].lineTotal" */
export function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') out += `[${key}]`;
    else out += out === '' ? String(key) : `.${String(key)}`;
  }
  return out;
}

function jsonTypeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function issue(ruleId: string, field: string, message: string, fix?: string): Issue {
  return { ruleId, severity: 'error', field, message, ...(fix === undefined ? {} : { fix }) };
}

function describeExpected(expected: string): string {
  return expected === 'object' ? 'an object' : expected === 'array' ? 'an array' : `a ${expected}`;
}

function toIssue(zi: z.core.$ZodIssue): Issue {
  const field = formatPath(zi.path);
  const input: unknown = zi.input;
  const name = field === '' ? 'The invoice' : `"${field}"`;

  // JSON has no undefined, so an undefined input always means the key is absent.
  if (input === undefined) {
    return issue(PARSE.MISSING_FIELD, field, `${name} is required but missing.`, `Add "${field}".`);
  }
  switch (zi.code) {
    case 'invalid_type':
      return issue(
        PARSE.WRONG_TYPE,
        field,
        `${name} must be ${describeExpected(zi.expected)}, but got ${jsonTypeOf(input)}.`,
      );
    case 'invalid_union':
      // Our only unions are "number or decimal string" (money, rates, quantities).
      return issue(
        PARSE.WRONG_TYPE,
        field,
        `${name} must be a number or a decimal string, but got ${jsonTypeOf(input)}.`,
        'Use a number like 1234.56 or a string like "1,234.56".',
      );
    case 'invalid_value':
      return issue(
        PARSE.INVALID_VALUE,
        field,
        `${name} is ${JSON.stringify(input)}, but must be one of: ${zi.values
          .map((v) => JSON.stringify(v))
          .join(', ')}.`,
      );
    case 'invalid_format':
      if (zi.format === 'date') {
        return issue(
          PARSE.INVALID_VALUE,
          field,
          `${name} is ${JSON.stringify(input)}, which is not a valid calendar date.`,
          'Use the YYYY-MM-DD format, e.g. "2026-03-15".',
        );
      }
      return issue(PARSE.INVALID_VALUE, field, `${name} ${zi.message}.`);
    default:
      // custom (money/decimal reasons) and anything else zod may add.
      return issue(PARSE.INVALID_VALUE, field, `${name}: ${zi.message}.`);
  }
}

/**
 * Parse a JSON invoice (a JSON string or an already-parsed object) into the
 * canonical model.
 */
export function parseJsonInvoice(input: string | object): JsonParseResult {
  let data: unknown;
  if (typeof input === 'string') {
    try {
      // Strip a UTF-8 byte-order mark, which JSON.parse rejects.
      const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
      data = JSON.parse(text);
    } catch (err) {
      const detail = err instanceof SyntaxError ? err.message : String(err);
      return {
        ok: false,
        parseErrors: [
          issue(
            PARSE.INVALID_JSON,
            '',
            `The input is not valid JSON: ${detail}`,
            'Check the file is well-formed JSON.',
          ),
        ],
      };
    }
  } else if (typeof input === 'object' && (input as object | null) !== null) {
    data = input;
  } else {
    throw new TypeError(
      `parseJsonInvoice: expected a JSON string or an object, got ${jsonTypeOf(input)}`,
    );
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return {
      ok: false,
      parseErrors: [
        issue(
          PARSE.NOT_AN_OBJECT,
          '',
          `The invoice must be a JSON object, but got ${jsonTypeOf(data)}.`,
          'Wrap the invoice fields in { ... }.',
        ),
      ],
    };
  }

  const result = InvoiceSchema.safeParse(data, { reportInput: true });
  if (result.success) return { ok: true, invoice: result.data };
  return { ok: false, parseErrors: result.error.issues.map(toIssue) };
}
