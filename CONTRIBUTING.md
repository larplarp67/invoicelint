# Contributing to invoicelint

Thanks for helping. Bug reports, rule requests and pull requests are all welcome.

## Setup

Requires Node.js 22.12+ and pnpm (via [Corepack](https://nodejs.org/api/corepack.html)).

```sh
corepack enable
pnpm install
pnpm check        # typecheck + lint + format check + tests
pnpm build        # dist/ (library + CLI)
pnpm check:dist   # the built package works in Node and in a browser bundle
```

Useful scripts:

| Script             | What it does                                                                          |
| ------------------ | ------------------------------------------------------------------------------------- |
| `pnpm test`        | Run the tests (vitest). `pnpm test:watch` to watch.                                   |
| `pnpm coverage`    | Tests with a coverage report.                                                         |
| `pnpm schema`      | Regenerate `schema/invoice.schema.json` from `src/model.ts`.                          |
| `pnpm docs:rules`  | Regenerate `docs/rules.md` from rule metadata (CI fails if it's stale).               |
| `pnpm test:peppol` | Download OpenPeppol's example invoices (not committed) and check they parse sensibly. |
| `pnpm smoke`       | Test the published package from npm, as a user would (see below).                     |

Try the CLI from source with `node dist/cli.js check <file>` after `pnpm build`.

## Ground rules

- **The law is the source of truth.** Every rule cites the exact provision it enforces. If a requirement isn't in the text, it doesn't become a rule.
- **Missing information is a warning, wrong data is an error.** The regulations let information come from several documents, so a gap on one invoice is never "illegal".
- **Rates and dates are sourced, never remembered.** Changes to `src/packs/ca-gst-hst/rates.ts` must cite the CRA page and update the retrieval date.
- **The core stays browser-safe.** Only `src/cli.ts` and `src/cli/` may use Node APIs; ESLint enforces this.
- **Money is integer cents.** No floating-point tax math.
- Non-obvious decisions go in [`docs/decisions.md`](./docs/decisions.md).

## Adding a rule

1. **Find the provision.** Quote it in the issue or PR, with a link (e.g. laws-lois.justice.gc.ca).
2. **Write the rule** in `src/packs/ca-gst-hst/rules/` with `defineRule()`:
   - a new, stable `id` (e.g. `CA-ITC-030`), never reusing an old one
   - `severity` following the policy above
   - a short `title`
   - a `citation` with the exact paragraph, e.g. `SOR/91-45 s.3(c)(iv)`
   - a `fix` hint written for a bookkeeper
   - `appliesFromTier` if it only applies from tier 2 or 3
3. **Write messages for a non-programmer.** Say what this document is missing or gets wrong, in plain English, with the real amounts.
4. **Register it** in the pack's `rules` array (`src/packs/ca-gst-hst/index.ts`).
5. **Add a fixture** in `test/fixtures/invalid/` with an `$expect` block listing the exact rule IDs it must produce, plus a UBL twin (`.xml`) when the case can be expressed in UBL. A test fails if any rule ID isn't produced by some fixture, or if a JSON fixture has no twin and no documented reason.
6. **Add unit tests** next to the others in `test/packs/ca-gst-hst/`.
7. **Regenerate the docs:** `pnpm docs:rules`, and commit `docs/rules.md`.
8. Note any interpretation in `docs/decisions.md`.

## Pull requests

- Keep commits small, with clear messages.
- `pnpm check` and `pnpm build` must pass; CI runs them on Node 22 and 24.
- Update `CHANGELOG.md` under "Unreleased" for user-visible changes.

## Before a release or demo

After `npm publish`, run the post-release smoke test. It uses the published package from npm, not your working copy, so it needs network access:

```sh
corepack pnpm smoke
```

[`scripts/smoke-test.ps1`](./scripts/smoke-test.ps1) recreates `C:\temp\invoicelint-smoke` and runs `npx invoicelint@latest` there:

- `--version` and `rules`
- `check` on a valid invoice and six broken copies generated from it, each changing one thing: a mistyped GST/HST number, a missing GST/HST number (also with `--strict`), a wrong total, GST at 7%, a $500+ invoice without a buyer, and US dollars
- `check` on a UBL invoice and a credit note

It then installs the package and calls `validate()` from an ES module. Each result is compared with the expected rule IDs and exit code. The script prints PASS/FAIL per case and a summary table, and exits non-zero if anything differs.

To test another version or folder, run it directly (Windows PowerShell 5.1 or PowerShell 7):

```sh
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-test.ps1 -Version 0.1.0 -Dir C:\temp\invoicelint-smoke-2
```

## Reporting bugs

Use the issue templates. For a wrong finding, include the invoice (with real names and numbers removed) and the output of `invoicelint check --format json`.
