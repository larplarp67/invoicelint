import { describe, expect, it } from 'vitest';
import { decodeInvoiceBytes } from '../src/decode.ts';

const text = (bytes: Uint8Array) => {
  const r = decodeInvoiceBytes(bytes);
  if (!r.ok) throw new Error(r.reason);
  return r;
};
const utf16le = (s: string) => {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    out[i * 2] = s.charCodeAt(i) & 0xff;
    out[i * 2 + 1] = s.charCodeAt(i) >> 8;
  }
  return out;
};
const utf16be = (s: string) => {
  const le = utf16le(s);
  const out = new Uint8Array(le.length);
  for (let i = 0; i < le.length; i += 2) {
    out[i] = le[i + 1] ?? 0;
    out[i + 1] = le[i] ?? 0;
  }
  return out;
};
const latin1 = (s: string) => Uint8Array.from({ length: s.length }, (_, i) => s.charCodeAt(i));

describe('decodeInvoiceBytes', () => {
  const sample = '{"supplier":{"name":"Érable Ltée"}}';

  it('reads plain UTF-8', () => {
    expect(text(new TextEncoder().encode(sample))).toEqual({
      ok: true,
      text: sample,
      encoding: 'utf-8',
    });
  });

  it('strips a UTF-8 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(sample)]);
    expect(text(bytes).text).toBe(sample);
  });

  it.each([
    ['UTF-16LE with BOM', new Uint8Array([0xff, 0xfe, ...utf16le(sample)]), 'utf-16le'],
    ['UTF-16BE with BOM', new Uint8Array([0xfe, 0xff, ...utf16be(sample)]), 'utf-16be'],
    ['UTF-16LE without BOM', utf16le(sample), 'utf-16le'],
    ['UTF-16BE without BOM', utf16be(sample), 'utf-16be'],
  ])('reads %s', (_label, bytes, encoding) => {
    expect(text(bytes)).toEqual({ ok: true, text: sample, encoding });
  });

  it('honours an XML encoding declaration (ISO-8859-1)', () => {
    const xml = '<?xml version="1.0" encoding="ISO-8859-1"?><n>Érable Ltée</n>';
    const r = text(latin1(xml));
    expect(r.text).toBe(xml);
    expect(r.encoding).toBe('windows-1252'); // WHATWG maps ISO-8859-1 to windows-1252
  });

  it('ignores a UTF-8 declaration (already the default)', () => {
    const xml = "<?xml version='1.0' encoding='utf-8'?><n>é</n>";
    expect(text(new TextEncoder().encode(xml)).text).toBe(xml);
  });

  it('refuses an encoding it does not know', () => {
    const r = decodeInvoiceBytes(
      new TextEncoder().encode('<?xml version="1.0" encoding="x-nope"?><a/>'),
    );
    expect(r).toEqual({
      ok: false,
      reason: 'the XML declares encoding "x-nope", which is not supported',
    });
  });

  it('handles empty input', () => {
    expect(text(new Uint8Array()).text).toBe('');
  });
});
