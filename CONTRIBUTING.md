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
- Give the PR a [Conventional Commits](https://www.conventionalcommits.org/) title (or the commit, when pushing straight to main): `feat:` for something users can do or will notice, `fix:` for a bug fix, `!` after the type (`feat!:`) for a breaking change, and `docs:`, `test:`, `refactor:`, `build:`, `ci:` or `chore:` for everything else. A scope is optional: `feat(ca-gst-hst): …`. release-please writes the CHANGELOG from these titles, so write them for users, and don't edit `CHANGELOG.md` by hand.

## Releasing

[release-please](https://github.com/googleapis/release-please) makes the releases, and [`.github/workflows/publish.yml`](./.github/workflows/publish.yml) publishes them to npm with [trusted publishing](https://docs.npmjs.com/trusted-publishers): there's no npm token, and npm adds provenance. Don't bump the version, push tags or run `npm publish` by hand.

1. **Merge PRs with Conventional Commits titles** (squash-merge, so the title is the commit on main). On every push to main, release-please opens or updates a release PR, "chore(main): release X.Y.Z". It holds the next version (`feat` bumps the minor version and `fix` the patch; below 1.0, a breaking change bumps the minor too), the CHANGELOG entry, and the new version in `package.json`, `VERSION` in `src/index.ts` and `.release-please-manifest.json`.
2. **Merge the release PR** when you want to release. release-please tags vX.Y.Z and creates the GitHub release, then the publish job checks out the tag, builds, tests and runs `npm publish`. Follow it under Actions > Publish.

Good to know:

- **CI doesn't run on the release PR**, because GitHub doesn't start workflows for a PR opened with `GITHUB_TOKEN`. The publish job builds and tests the tag before publishing. To run CI on the release PR anyway, close and reopen it.
- **Rewording an entry:** edit `CHANGELOG.md` in the release PR just before merging it (release-please rewrites the PR whenever main changes). To change a squash-merged PR's entry for good, add `BEGIN_COMMIT_OVERRIDE`, the corrected title, and `END_COMMIT_OVERRIDE`, each on its own line, to that PR's description.
- **Not bumped automatically:** the pack's `version` in `src/packs/ca-gst-hst/index.ts` (bump it in a normal PR when the rules change, then run `pnpm docs:rules`) and the version in the README's JSON output example.
- **Dry run:** Actions > Publish > Run workflow runs the publish job on the chosen branch under a version that isn't on npm, ending in `npm publish --dry-run`, and fails if npm doesn't accept the workflow as the trusted publisher. Nothing is released or published.
- **If publishing fails** after the GitHub release was created: for a passing problem (an npm outage), re-run the failed job. For a problem in the code, the tag can't be fixed: merge a `fix:` and release the next patch version. Once a version is on npm, its number can't be published again, even after an unpublish.

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

To run the same cases on a release **before** publishing it, pack it and pass the tarball (no network access needed for the package itself, though npm still installs its dependencies):

```sh
pnpm build
pnpm pack
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-test.ps1 -Package invoicelint-0.2.0.tgz
```

This doesn't replace the run after `npm publish`, which checks what users actually download.

## Reporting bugs

Use the issue templates. For a wrong finding, include the invoice (with real names and numbers removed) and the output of `invoicelint check --format json`.
