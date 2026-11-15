import { describe, expect, it } from 'vitest';
import { exampleById } from '../src/examples.ts';
import { type FieldLocation, fieldLocator, locateField, parseFieldPath } from '../src/locate.ts';

function exampleText(id: string): string {
  const example = exampleById(id);
  if (example === undefined) throw new Error(`no example ${id}`);
  return example.text;
}

/** The selected text. */
function selected(text: string, location: FieldLocation | undefined): string {
  if (location === undefined) throw new Error('not located');
  return text.slice(location.start, location.end);
}

/** The whole text with "|" where the caret is. */
function caret(text: string, location: FieldLocation | undefined): string {
  if (location === undefined) throw new Error('not located');
  expect(location.start).toBe(location.end);
  return `${text.slice(0, location.start)}|${text.slice(location.end)}`;
}

describe('parseFieldPath', () => {
  it.each([
    ['total', ['total']],
    ['supplier.gstHstNumber', ['supplier', 'gstHstNumber']],
    ['lines[2].lineTotal', ['lines', 2, 'lineTotal']],
    ['taxes[0]', ['taxes', 0]],
    ['taxIncludedStatement.rate', ['taxIncludedStatement', 'rate']],
  ])('%s', (field, path) => {
    expect(parseFieldPath(field)).toEqual(path);
  });

  it.each(['', '.total', 'a..b', 'lines[x]', 'lines[2', '[0]', 'a b'])('rejects %j', (field) => {
    expect(parseFieldPath(field)).toBeUndefined();
  });
});

describe('locateField', () => {
  const typo = exampleText('gst-number-typo');

  it('selects a field and its value', () => {
    const at = locateField(typo, 'supplier.gstHstNumber');
    expect(at?.found).toBe(true);
    expect(selected(typo, at)).toBe('"gstHstNumber": "822344454RT0001"');
  });

  it('follows array indexes', () => {
    expect(selected(typo, locateField(typo, 'taxes[0].rate'))).toBe('"rate": 13');
    expect(selected(typo, locateField(typo, 'lines[0].lineTotal'))).toBe('"lineTotal": "150.00"');
  });

  it('selects a whole array item or array', () => {
    const item = selected(typo, locateField(typo, 'taxes[0]'));
    expect(item.startsWith('{')).toBe(true);
    expect(item.endsWith('}')).toBe(true);
    expect(item).toContain('"amount": "19.50"');
    expect(selected(typo, locateField(typo, 'lines')).startsWith('"lines": [')).toBe(true);
  });

  it('finds the key at the right depth, not the first with that name', () => {
    const text = '{"supplier": {"name": "S"}, "buyer": {"name": "B"}}';
    expect(selected(text, locateField(text, 'buyer.name'))).toBe('"name": "B"');
  });

  it('is not fooled by brackets, quotes and escapes inside strings', () => {
    const text = '{"a": "x}\\"]{,", "b": [1, "]", {"c": "d"}]}';
    expect(selected(text, locateField(text, 'b[2].c'))).toBe('"c": "d"');
  });

  it('uses the last of duplicate keys, as JSON.parse does', () => {
    const text = '{"a": 1, "a": 2}';
    expect(selected(text, locateField(text, 'a'))).toBe('"a": 2');
  });

  it('skips a byte order mark', () => {
    const text = `${String.fromCharCode(0xfeff)}{"total": "1.00"}`;
    expect(selected(text, locateField(text, 'total'))).toBe('"total": "1.00"');
  });

  describe('a field that is not in the invoice', () => {
    const plumber = exampleText('plumber-missing-buyer-terms');

    it('puts a caret after the last field of the nearest object', () => {
      const at = locateField(plumber, 'paymentTerms');
      expect(at?.found).toBe(false);
      expect(caret(plumber, at).endsWith('"total": "678.00"|\n}')).toBe(true);
      // The buyer object is missing too, so a buyer name goes in the same place.
      expect(locateField(plumber, 'buyer.name')).toEqual(at);
    });

    it('goes inside an empty object or array', () => {
      const text = '{"buyer": {}, "lines": []}';
      expect(caret(text, locateField(text, 'buyer.name'))).toBe('{"buyer": {|}, "lines": []}');
      expect(caret(text, locateField(text, 'lines[0]'))).toBe('{"buyer": {}, "lines": [|]}');
    });

    it('goes after the last item of a shorter array', () => {
      const text = '{"lines": [{"a": 1}]}';
      expect(caret(text, locateField(text, 'lines[3].a'))).toBe('{"lines": [{"a": 1}|]}');
    });

    it('selects a value that is in the way', () => {
      const text = '{"supplier": "Dave"}';
      const at = locateField(text, 'supplier.name');
      expect(at?.found).toBe(false);
      expect(selected(text, at)).toBe('"Dave"');
    });
  });

  it('gives up on invalid JSON, the whole document and odd paths', () => {
    expect(locateField('{"total": ', 'total')).toBeUndefined();
    expect(locateField('<Invoice/>', 'total')).toBeUndefined();
    expect(locateField(typo, '')).toBeUndefined();
    expect(locateField(typo, 'a..b')).toBeUndefined();
  });

  it('reads the text once for many fields', () => {
    const locate = fieldLocator(typo);
    expect(locate('total')?.found).toBe(true);
    expect(locate('supplier.name')?.found).toBe(true);
    expect(locate('buyer.name')?.found).toBe(false);
  });
});
