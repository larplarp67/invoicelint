# invoicelint

> **Status: early development (v0.0.0).** Nothing is published yet. The sections below are placeholders that later phases fill in.

`invoicelint` checks whether an invoice has everything a buyer needs to claim tax credits, and whether its tax math adds up. Every finding comes with a rule ID, a severity, the field involved, a plain-English fix and a citation to the law.

It starts with Canada (GST/HST input tax credits). Rules ship in pluggable **rule packs**, so packs for other countries can be added later.

## What are input tax credits?

_TODO (phase 5): a two-sentence explanation._

## Install

_TODO (phase 5)._

## Usage

```sh
invoicelint check invoice.json --format pretty
```

_TODO (phase 5): library API, examples and sample output._

## Rules

_TODO (phase 3/5): a rule table with citations to SOR/91-45, s. 3._

## Development

Requires Node 22+ and pnpm (via [Corepack](https://nodejs.org/api/corepack.html): `corepack enable`).

```sh
pnpm install
pnpm check     # typecheck + lint + format check + tests
pnpm build
```

## Disclaimer

This is not tax or legal advice. _TODO (phase 5): full disclaimer._

## License

[MIT](./LICENSE)
