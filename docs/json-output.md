# JSON output

`invoicelint check --format json` (the default when stdout is not a terminal) prints one JSON document for all the files checked. The shape is stable: `schemaVersion` changes only on a breaking change. The TypeScript types are exported as `JsonOutput` and `JsonFileOutput`, and `toJsonOutput()` builds the same document in code (it works in the browser too).

```ts
interface JsonOutput {
  schemaVersion: 1;
  tool: { name: 'invoicelint'; version: string };
  summary: {
    files: number;
    passed: number; // status "ok"
    failed: number; // status "failed": errors, or warnings with --strict
    skipped: number; // status "skipped": recognized but no rules ran (a UBL credit note)
    inputErrors: number; // status "input-error": unreadable, undecodable or unparseable files
    errors: number;
    warnings: number;
    strict: boolean;
  };
  files: JsonFileOutput[];
}

interface JsonFileOutput {
  file: string; // as given on the command line, or as a wildcard expanded it
  status: 'ok' | 'failed' | 'skipped' | 'input-error'; // see "File status" below
  format?: 'json' | 'ubl'; // absent when the file could not be read
  tier?: number; // 1, 2 or 3; absent when no rules ran, and for a negative total (CA-TOTAL-001)
  packs: { id: string; version: string }[]; // rule packs that ran
  errors: Issue[];
  warnings: Issue[];
  infos: Issue[]; // always included, whatever --verbose says
}

interface Issue {
  ruleId: string; // e.g. "CA-ITC-010", "PARSE-005", "INPUT-001"
  severity: 'error' | 'warning' | 'info';
  field: string; // e.g. "lines[2].lineTotal"; "" for the whole document
  message: string; // plain English
  fix?: string; // plain English
  citation?: string; // e.g. "SOR/91-45 s.3(b)(i)"
}
```

The [README](../README.md#output) has a complete example.

## File status

| `status`      | Pretty output                               | Meaning                                                                                        | Exit code |
| ------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------- |
| `ok`          | `✓ OK` (or `✓ OK · 2 warnings`)             | Rules ran and found no errors (and no warnings, with `--strict`).                              | `0`       |
| `failed`      | `✗ 1 error, 0 warnings`                     | Errors, or warnings with `--strict`.                                                           | `1`       |
| `skipped`     | `⊘ SKIPPED — credit note (not checked yet)` | Recognized, but no rules ran: a UBL credit note. Never fails, even with `--strict`. No `tier`. | `0`       |
| `input-error` | `✗ input error`                             | The file couldn't be read or decoded, or isn't a parseable invoice. The reason is in `errors`. | `2`       |

## Exit codes

| Code | Meaning                                                                                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | No errors (warnings allowed, unless `--strict`). A skipped file (a credit note) counts as 0, even with `--strict`.                                              |
| `1`  | At least one file has errors, or warnings with `--strict`.                                                                                                      |
| `2`  | Usage error (bad option, unknown pack, wildcard matching nothing) or input error (a file is unreadable, undecodable or not a parseable invoice). Wins over `1`. |

## Rule ID families

| Prefix            | Where it comes from                                                                                                                                                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CA-…`            | The `ca-gst-hst` rule pack. Every rule, with its citation: [rules.md](./rules.md).                                                                                                                                                                                                                                        |
| `PARSE-001`…`005` | The JSON / model parser: invalid JSON, not an object, missing field, wrong type, invalid value.                                                                                                                                                                                                                           |
| `PARSE-UBL-0xx`   | The UBL parser: `001` not a UBL invoice, `002` malformed XML, `003` DTD refused, `004` too large, `010` credit note (info), `020` unmapped tax category (info), `021` tax not classified as GST/HST (info), `022` value deliberately not mapped (info), `030` amount in another currency, `031` required element missing. |
| `INPUT-001`       | The CLI could not read the file.                                                                                                                                                                                                                                                                                          |
| `INPUT-002`       | The CLI could not decode the file (an XML encoding it doesn't support).                                                                                                                                                                                                                                                   |

A file whose parsing failed has status `input-error`; `PARSE-UBL-030` and `PARSE-UBL-031` (for anything except the total) are reported as errors alongside the rule findings, because the invoice could still be checked.
