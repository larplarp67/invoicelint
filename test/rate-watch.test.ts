import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type Snapshot,
  SNAPSHOT_PATH,
  compare,
  craPageProblems,
  issueBody,
  parseLastAmended,
  parseTables,
} from '../scripts/rate-watch.ts';
import { PROVINCE_NAMES, RATE_TABLE, RATES_SOURCE } from '../src/packs/ca-gst-hst/rates.ts';

const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as Snapshot;

/** A copy of the snapshot with some changes, for compare(). */
function edited(change: (s: Snapshot) => void): Snapshot {
  const copy = structuredClone(snapshot);
  change(copy);
  return copy;
}

function cell(s: Snapshot, caption: string, rowName: string, column: number): string[] {
  const row = s.cra.tables.find((t) => t.caption === caption)?.rows.find((r) => r[0] === rowName);
  if (row === undefined) throw new Error(`no row ${rowName} in ${caption}`);
  if (row[column] === undefined) throw new Error(`no column ${String(column)}`);
  return row;
}

describe('parseTables', () => {
  it('reads captions and cell text, ignoring markup and entities', () => {
    const html = `
      <p>Not a table</p>
      <table class="table"><caption><strong>GST/HST</strong>&nbsp;rates</caption>
        <thead><tr><th scope="col">Province</th><th>Rate</th></tr></thead>
        <tbody>
          <tr><th scope="row">Newfoundland &amp; Labrador</th><td>15<abbr title="percent">%</abbr></td></tr>
          <tr><td>Quebec</td><td>
            5&#37;</td></tr>
          <tr><td>Line<br>break</td><td>x</td></tr>
        </tbody>
      </table>
      <table><tr><td>Second</td></tr></table>`;
    expect(parseTables(html)).toEqual([
      {
        caption: 'GST/HST rates',
        rows: [
          ['Province', 'Rate'],
          ['Newfoundland & Labrador', '15%'],
          ['Quebec', '5%'],
          ['Line break', 'x'],
        ],
      },
      { caption: '', rows: [['Second']] },
    ]);
  });

  it('finds no tables in a page without any', () => {
    expect(parseTables('<html><body>Moved</body></html>')).toEqual([]);
  });
});

describe('parseLastAmended', () => {
  it('reads the date on the root element only', () => {
    const xml =
      '<?xml version="1.0"?><Regulation lims:pit-date="2024-06-20" lims:lastAmendedDate="2024-06-20" lims:current-date="2026-10-29"><Section lims:lastAmendedDate="1999-01-01"/></Regulation>';
    expect(parseLastAmended(xml)).toBe('2024-06-20');
  });

  it('is undefined when the attribute or the element is missing', () => {
    expect(parseLastAmended('<Regulation lims:pit-date="2024-06-20">')).toBeUndefined();
    expect(parseLastAmended('<html>Not found</html>')).toBeUndefined();
  });
});

describe('craPageProblems', () => {
  it('accepts the recorded page', () => {
    expect(craPageProblems(snapshot.cra.tables)).toEqual([]);
  });

  it('notices a renamed table or a missing province', () => {
    expect(craPageProblems([{ caption: 'Rates', rows: [] }])).toEqual([
      `no table captioned "${RATES_SOURCE.table}" (tables found: "Rates")`,
    ]);
    const withoutYukon = edited((s) => {
      for (const t of s.cra.tables) t.rows = t.rows.filter((r) => r[0] !== 'Yukon');
    });
    expect(craPageProblems(withoutYukon.cra.tables)).toEqual([
      `"${RATES_SOURCE.table}" has no row for Yukon`,
    ]);
  });
});

describe('compare', () => {
  it('finds no change between the snapshot and itself', () => {
    const result = compare(snapshot, structuredClone(snapshot));
    expect(result.changed).toBe(false);
    expect(result.changes).toEqual([]);
  });

  it('reports a new "last amended" date for SOR/91-45', () => {
    const after = edited((s) => {
      s.sor9145.lastAmended = '2027-01-01';
    });
    const result = compare(snapshot, after);
    expect(result.changed).toBe(true);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toContain('from 2024-06-20 to 2027-01-01');
  });

  it('marks a changed rate and keeps the rest of the table', () => {
    const after = edited((s) => {
      const row = cell(s, RATES_SOURCE.table, 'Ontario', 1);
      row[1] = '15%';
    });
    const [change = ''] = compare(snapshot, after).changes;
    expect(change).toContain(`"${RATES_SOURCE.table}" changed`);
    expect(change).toContain('| Ontario | **15%** (was 13%) | 13% |');
    expect(change).toContain('| Alberta | 5% | 5% |');
  });

  it('shows the whole table when the columns change (a new rate period)', () => {
    const after = edited((s) => {
      const table = s.cra.tables.find((t) => t.caption === RATES_SOURCE.table);
      if (table === undefined) throw new Error('no table');
      table.rows = table.rows.map((r, i) => [
        r[0] ?? '',
        i === 0 ? 'On or after July 1, 2027' : '5%',
        ...r.slice(1),
      ]);
    });
    const [change = ''] = compare(snapshot, after).changes;
    expect(change).toContain('has different columns');
    expect(change).toContain('| Province | On or after July 1, 2027 |');
  });

  it('reports added and removed rows and tables', () => {
    const after = edited((s) => {
      const [current, history] = s.cra.tables;
      if (current === undefined || history === undefined) throw new Error('tables');
      current.rows = current.rows.filter((r) => r[0] !== 'Quebec');
      current.rows.push(['Atlantis', '20%', 'N/A']);
      history.caption = 'GST/HST rates since 2017';
    });
    const changes = compare(snapshot, after).changes.join('\n');
    expect(changes).toContain('| Atlantis (new row) | 20% | N/A |');
    expect(changes).toContain('Rows removed: Quebec.');
    expect(changes).toContain(`Table "${RATES_SOURCE.table}" is gone`);
    expect(changes).toContain('New table "GST/HST rates since 2017"');
  });

  it('fingerprints the new snapshot, so the same change is reported once', () => {
    const after = edited((s) => {
      s.sor9145.lastAmended = '2027-01-01';
    });
    const a = compare(snapshot, after);
    expect(compare(snapshot, structuredClone(after)).fingerprint).toBe(a.fingerprint);
    expect(compare(snapshot, snapshot).fingerprint).not.toBe(a.fingerprint);
    const body = issueBody(a, 'https://github.com/o/r/actions/runs/1');
    expect(body).toContain(`<!-- rate-watch:${a.fingerprint} -->`);
    expect(body).toContain('([run](https://github.com/o/r/actions/runs/1))');
    expect(body).toContain('Nothing was changed automatically.');
  });
});

describe('the recorded snapshot agrees with rates.ts', () => {
  const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  /** "2025-04-01" -> "April 1, 2025", as the CRA writes dates. */
  const longDate = (iso: string): string => {
    const [y = 0, m = 1, d = 1] = iso.split('-').map(Number);
    return `${MONTHS[m - 1] ?? ''} ${String(d)}, ${String(y)}`;
  };
  const history = snapshot.cra.tables.find((t) => t.caption === RATES_SOURCE.table);
  const current = snapshot.cra.tables.find((t) => t.caption === 'GST/HST and PST rates');
  const header = history?.rows[0] ?? [];
  const row = (table: typeof history, name: string) => table?.rows.find((r) => r[0] === name);

  it.each(RATE_TABLE.map((e) => [e.jurisdiction, e.effectiveFrom, e] as const))(
    '%s from %s',
    (code, _from, entry) => {
      const period =
        entry.effectiveTo === undefined
          ? `On or after ${longDate(entry.effectiveFrom)}`
          : `${longDate(entry.effectiveFrom)} to ${longDate(entry.effectiveTo)}`;
      const column = header.indexOf(period);
      expect(column, `CRA column "${period}"`).toBeGreaterThan(0);
      expect(row(history, PROVINCE_NAMES[code])?.[column]).toBe(`${entry.rate}%`);
    },
  );

  it.each(Object.entries(PROVINCE_NAMES))(
    '%s: current rate and GST/HST type match the current-rates table',
    (code, name) => {
      const latest = RATE_TABLE.find((e) => e.jurisdiction === code && e.effectiveTo === undefined);
      const [, rate, pst] = row(current, name) ?? [];
      expect(rate).toBe(`${latest?.rate ?? '?'}%`);
      // rates.ts: HST provinces are the ones whose PST is "N/A".
      expect(pst === 'N/A').toBe(latest?.type === 'HST');
    },
  );
});
