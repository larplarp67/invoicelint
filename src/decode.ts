/**
 * Turn raw file bytes into text before parsing. Browser-safe (TextDecoder), so
 * the CLI and a browser drop-zone decode files the same way.
 *
 * Order:
 * 1. A byte-order mark wins: UTF-8, UTF-16LE or UTF-16BE.
 * 2. UTF-16 without a BOM is recognised from the zero bytes around the first
 *    "<" or "{" (Windows tools sometimes write it).
 * 3. Otherwise the start is read as UTF-8. If it is XML whose declaration names
 *    another encoding (e.g. ISO-8859-1, windows-1252), the bytes are decoded
 *    with that encoding instead.
 */

/** Result of {@link decodeInvoiceBytes}: the text and the encoding used, or why it failed. */
export type DecodeResult =
  { ok: true; text: string; encoding: string } | { ok: false; reason: string };

function decode(bytes: Uint8Array, label: string, offset = 0): string {
  return new TextDecoder(label).decode(bytes.subarray(offset));
}

/** Decode raw file bytes to text: BOM first (UTF-8/UTF-16), then BOM-less UTF-16, then the XML encoding declaration, else UTF-8. Use it before {@link validate} when you have bytes (a file, an upload). */
export function decodeInvoiceBytes(bytes: Uint8Array): DecodeResult {
  const [b0, b1, b2] = bytes;
  if (b0 === 0xef && b1 === 0xbb && b2 === 0xbf) {
    return { ok: true, text: decode(bytes, 'utf-8', 3), encoding: 'utf-8' };
  }
  if (b0 === 0xff && b1 === 0xfe)
    return { ok: true, text: decode(bytes, 'utf-16le', 2), encoding: 'utf-16le' };
  if (b0 === 0xfe && b1 === 0xff)
    return { ok: true, text: decode(bytes, 'utf-16be', 2), encoding: 'utf-16be' };

  // UTF-16 without BOM: "<" or "{" next to a zero byte.
  const opener = (b: number | undefined) => b === 0x3c || b === 0x7b;
  if (opener(b0) && b1 === 0x00)
    return { ok: true, text: decode(bytes, 'utf-16le'), encoding: 'utf-16le' };
  if (b0 === 0x00 && opener(b1))
    return { ok: true, text: decode(bytes, 'utf-16be'), encoding: 'utf-16be' };

  // An XML declaration is ASCII, so it can be read before the encoding is known.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  const declared = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([A-Za-z0-9._:-]+)["']/.exec(head)?.[1];
  if (declared !== undefined && !/^utf-?8$/i.test(declared)) {
    let decoder: InstanceType<typeof TextDecoder>;
    try {
      decoder = new TextDecoder(declared);
    } catch {
      return {
        ok: false,
        reason: `the XML declares encoding "${declared}", which is not supported`,
      };
    }
    return { ok: true, text: decoder.decode(bytes), encoding: decoder.encoding };
  }
  return { ok: true, text: decode(bytes, 'utf-8'), encoding: 'utf-8' };
}
