/**
 * Watches the sources of the GST/HST rate table and the input tax credit rules.
 *
 *   pnpm rate-watch            compare the live sources with data/watch-snapshot.json
 *   pnpm rate-watch --update   record the live sources in data/watch-snapshot.json
 *
 * Watched:
 * - The CRA page the rate table was transcribed from (RATES_SOURCE in
 *   src/packs/ca-gst-hst/rates.ts): every table on it, cell by cell, as published.
 * - SOR/91-45, the Input Tax Credit Information (GST/HST) Regulations: the
 *   "last amended" date, from the Justice Laws XML.
 *
 * It never changes rates. .github/workflows/rate-watch.yml runs the check once
 * a month and opens an issue when something changed; a person then updates
 * rates.ts (or the rules) and records the new snapshot with --update.
 * test/rate-watch.test.ts checks that the snapshot agrees with rates.ts.
 *
 * Exits 0 after comparing, whether or not anything changed, and 1 when a
 * source can't be fetched or no longer looks as expected (check it by hand).
 * In GitHub Actions it also writes changed=true|false to $GITHUB_OUTPUT and a
 * summary to $GITHUB_STEP_SUMMARY; --report <file> saves the issue text.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PROVINCE_NAMES, RATES_SOURCE } from '../src/packs/ca-gst-hst/rates.ts';

export const SNAPSHOT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../data/watch-snapshot.json',
);

export const SOR_91_45 = {
  page: 'https://laws-lois.justice.gc.ca/eng/regulations/SOR-91-45/',
  xml: 'https://laws-lois.justice.gc.ca/eng/XML/SOR-91-45.xml',
} as const;

const USER_AGENT = 'invoicelint-rate-watch (+https://github.com/larplarp67/invoicelint)';
const ATTEMPTS = 3;

export interface Table {
  caption: string;
  /** Cell text, header row first. */
  rows: string[][];
}

export interface Snapshot {
  cra: { url: string; tables: Table[] };
  sor9145: { url: string; lastAmended: string };
}

// ---- Reading the sources

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const hex = entity[1] === 'x' || entity[1] === 'X';
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * The visible text of an HTML fragment, with whitespace collapsed. Line breaks
 * and block tags separate words; inline tags (<abbr>, <strong>...) don't.
 */
const textOf = (html: string): string =>
  decodeEntities(
    html.replace(/<\/?(?:br|p|div|li|ul|ol|tr|td|th)\b[^>]*>/gi, ' ').replace(/<[^>]*>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();

/** Every <table> in a page: its caption and the text of each cell, row by row. */
export function parseTables(html: string): Table[] {
  return Array.from(html.matchAll(/<table\b[\s\S]*?<\/table>/gi), ([table]) => ({
    caption: textOf(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i.exec(table)?.[1] ?? ''),
    rows: Array.from(table.matchAll(/<tr\b[\s\S]*?<\/tr>/gi), ([row]) =>
      Array.from(row.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi), ([, cell = '']) =>
        textOf(cell),
      ),
    ),
  }));
}

/** The lims:lastAmendedDate on the root <Regulation> element of a Justice Laws XML file. */
export function parseLastAmended(xml: string): string | undefined {
  const root = /<Regulation\b[^>]*>/.exec(xml)?.[0];
  return root === undefined
    ? undefined
    : /\slims:lastAmendedDate="(\d{4}-\d{2}-\d{2})"/.exec(root)?.[1];
}

/**
 * Problems that mean the page no longer looks like the one rates.ts was
 * transcribed from, so a comparison wouldn't mean much.
 */
export function craPageProblems(tables: readonly Table[]): string[] {
  const source = tables.find((t) => t.caption === RATES_SOURCE.table);
  if (source === undefined) {
    const found = tables.map((t) => `"${t.caption}"`).join(', ') || 'none';
    return [`no table captioned "${RATES_SOURCE.table}" (tables found: ${found})`];
  }
  const names = new Set(source.rows.map((r) => r[0]));
  return Object.values(PROVINCE_NAMES)
    .filter((name) => !names.has(name))
    .map((name) => `"${RATES_SOURCE.table}" has no row for ${name}`);
}

async function fetchText(url: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      if (attempt < ATTEMPTS) {
        await new Promise((done) => setTimeout(done, attempt * 5_000));
      }
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`couldn't fetch ${url} (${ATTEMPTS} attempts): ${reason}`);
}

/** Fetch both sources now. Throws if either can't be fetched or read. */
export async function takeSnapshot(): Promise<Snapshot> {
  const [html, xml] = await Promise.all([fetchText(RATES_SOURCE.url), fetchText(SOR_91_45.xml)]);
  const tables = parseTables(html);
  const problems = craPageProblems(tables);
  if (problems.length > 0) {
    throw new Error(`the CRA page has changed shape: ${problems.join('; ')}`);
  }
  const lastAmended = parseLastAmended(xml);
  if (lastAmended === undefined) {
    throw new Error(`no lims:lastAmendedDate on <Regulation> in ${SOR_91_45.xml}`);
  }
  return {
    cra: { url: RATES_SOURCE.url, tables },
    sor9145: { url: SOR_91_45.xml, lastAmended },
  };
}

// ---- Comparing

const md = (text: string): string => text.replace(/\|/g, '\\|');

function markdownTable(rows: readonly (readonly string[])[]): string {
  const [head = [], ...body] = rows;
  return [
    `| ${head.map(md).join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...body.map((r) => `| ${r.map(md).join(' | ')} |`),
  ].join('\n');
}

/** What changed in one table, as Markdown, or undefined if nothing did. */
function tableChange(caption: string, before?: Table, after?: Table): string | undefined {
  if (before === undefined && after !== undefined) {
    return `**New table "${caption}"** on the CRA page:\n\n${markdownTable(after.rows)}`;
  }
  if (after === undefined) return `**Table "${caption}" is gone** from the CRA page.`;
  if (before === undefined || JSON.stringify(before.rows) === JSON.stringify(after.rows)) {
    return undefined;
  }
  const [oldHead = [], ...oldBody] = before.rows;
  const [newHead = [], ...newBody] = after.rows;
  if (JSON.stringify(oldHead) !== JSON.stringify(newHead)) {
    return [
      `**"${caption}" has different columns.** Was: ${oldHead.join(' | ')}. Now:`,
      '',
      markdownTable(after.rows),
    ].join('\n');
  }
  // Same columns: mark each changed cell, matching rows by their first cell.
  const oldRows = new Map(oldBody.map((r) => [r[0] ?? '', r]));
  const marked = newBody.map((row) => {
    const old = oldRows.get(row[0] ?? '');
    if (old === undefined) return row.map((cell, i) => (i === 0 ? `${cell} (new row)` : cell));
    return row.map((cell, i) => (old[i] === cell ? cell : `**${cell}** (was ${old[i] ?? '—'})`));
  });
  const newNames = new Set(newBody.map((r) => r[0]));
  const removed = oldBody.filter((r) => !newNames.has(r[0])).map((r) => r[0] ?? '');
  return [
    `**"${caption}" changed** (changed cells in bold):`,
    '',
    markdownTable([newHead, ...marked]),
    ...(removed.length > 0 ? ['', `Rows removed: ${removed.join(', ')}.`] : []),
  ].join('\n');
}

export interface Comparison {
  changed: boolean;
  /** One Markdown paragraph per change. */
  changes: string[];
  /** Identifies the new snapshot, so the same change isn't reported twice. */
  fingerprint: string;
}

export function compare(before: Snapshot, after: Snapshot): Comparison {
  const changes: string[] = [];
  if (before.sor9145.lastAmended !== after.sor9145.lastAmended) {
    changes.push(
      `**SOR/91-45 was amended.** Justice Laws' "last amended" date went from ${before.sor9145.lastAmended} to ${after.sor9145.lastAmended}. Read the [current regulations](${SOR_91_45.page}) (Previous Versions shows the old text).`,
    );
  }
  const captions = [...new Set([...before.cra.tables, ...after.cra.tables].map((t) => t.caption))];
  for (const caption of captions) {
    const change = tableChange(
      caption,
      before.cra.tables.find((t) => t.caption === caption),
      after.cra.tables.find((t) => t.caption === caption),
    );
    if (change !== undefined) changes.push(change);
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(after)).digest('hex').slice(0, 16);
  return { changed: changes.length > 0, changes, fingerprint };
}

/** The issue text for a comparison that found changes. */
export function issueBody(comparison: Comparison, runUrl?: string): string {
  return [
    `The monthly rate watch found changes since \`data/watch-snapshot.json\`${runUrl === undefined ? '' : ` ([run](${runUrl}))`}. Sources: [CRA GST/HST rates](${RATES_SOURCE.url}) and [SOR/91-45](${SOR_91_45.page}).`,
    '',
    '## What changed',
    '',
    ...comparison.changes.flatMap((c) => [c, '']),
    '## What to do',
    '',
    'Nothing was changed automatically.',
    '',
    "1. Read the change on the source page. A PST-only change doesn't affect invoicelint.",
    '2. If GST/HST rates changed, update `PERIODS`, `SOURCE_ROWS` and `RATES_SOURCE` in `src/packs/ca-gst-hst/rates.ts`, and the tests. If SOR/91-45 changed, check whether the ITC rules or their citations need to follow.',
    '3. Run `pnpm rate-watch --update` to record the new snapshot. `test/rate-watch.test.ts` checks that it agrees with `rates.ts`.',
    '4. Commit: `fix:` if the rates or rules changed (that releases a new version), otherwise `chore:`. Then close this issue.',
    '',
    `<!-- rate-watch:${comparison.fingerprint} -->`,
    '',
  ].join('\n');
}

function summary(snapshot: Snapshot): string {
  const tables = snapshot.cra.tables.map((t) => `"${t.caption}" (${t.rows.length - 1} rows)`);
  return `the CRA page's tables ${tables.join(' and ')}, and SOR/91-45 (last amended ${snapshot.sor9145.lastAmended})`;
}

// ---- Command line

async function main(args: readonly string[]): Promise<number> {
  let after: Snapshot;
  try {
    after = await takeSnapshot();
  } catch (err) {
    console.error(`rate-watch: ${err instanceof Error ? err.message : String(err)}`);
    console.error('Check the sources by hand; the page may have been redesigned.');
    return 1;
  }

  if (args.includes('--update')) {
    const prettier = await import('prettier');
    const options = (await prettier.resolveConfig(SNAPSHOT_PATH)) ?? {};
    const text = await prettier.format(JSON.stringify(after), {
      ...options,
      filepath: SNAPSHOT_PATH,
    });
    mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
    writeFileSync(SNAPSHOT_PATH, text);
    console.log(`Recorded ${summary(after)} in data/watch-snapshot.json.`);
    return 0;
  }

  if (!existsSync(SNAPSHOT_PATH)) {
    console.error('rate-watch: no data/watch-snapshot.json yet. Run `pnpm rate-watch --update`.');
    return 1;
  }
  const before = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as Snapshot;
  const comparison = compare(before, after);
  const {
    GITHUB_OUTPUT,
    GITHUB_STEP_SUMMARY,
    GITHUB_SERVER_URL,
    GITHUB_REPOSITORY,
    GITHUB_RUN_ID,
  } = process.env;
  const runUrl =
    GITHUB_RUN_ID === undefined
      ? undefined
      : `${GITHUB_SERVER_URL ?? 'https://github.com'}/${GITHUB_REPOSITORY ?? ''}/actions/runs/${GITHUB_RUN_ID}`;
  const body = issueBody(comparison, runUrl);

  const reportAt = args.indexOf('--report');
  const reportPath = reportAt === -1 ? undefined : args[reportAt + 1];
  if (reportPath !== undefined) writeFileSync(reportPath, body);
  if (GITHUB_OUTPUT !== undefined) {
    appendFileSync(GITHUB_OUTPUT, `changed=${String(comparison.changed)}\n`);
  }

  const message = comparison.changed
    ? body
    : `No change since data/watch-snapshot.json: ${summary(after)}.`;
  console.log(message);
  if (GITHUB_STEP_SUMMARY !== undefined) {
    appendFileSync(
      GITHUB_STEP_SUMMARY,
      comparison.changed
        ? `## Rate watch: changes found\n\n${body}`
        : `## Rate watch\n\n${message}\n`,
    );
  }
  return 0;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  process.exitCode = await main(process.argv.slice(2));
}
