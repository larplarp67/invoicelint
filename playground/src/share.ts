/**
 * Share links carry the invoice in the URL hash: "#invoice=" and then the
 * text, deflate-compressed and base64url-encoded. Browsers don't send the hash
 * to the server, but anyone who has the link can read the invoice. No DOM
 * here; it runs in Node for the tests.
 */

const PREFIX = '#invoice=';

/**
 * Longest share link the page offers to copy. A typical invoice needs a few
 * hundred characters; past this, chat apps and email start cutting links off.
 */
export const MAX_SHARE_URL_LENGTH = 32_000;

export type SharedInvoice = { ok: true; text: string } | { ok: false; reason: string };

const DAMAGED =
  "This share link is damaged or incomplete, so the invoice in it couldn't be opened.";

function concat(chunks: readonly Uint8Array[], size: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Read a stream to the end, or give up once it passes maxBytes. */
async function readAll(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array | undefined> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return concat(chunks, size);
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  // In slices, so a large invoice doesn't overflow the argument list.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return undefined;
  const base64 = text.replaceAll('-', '+').replaceAll('_', '/');
  try {
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return undefined;
  }
}

/** The URL hash (with its "#") that carries this invoice text. */
export async function shareHash(text: string): Promise<string> {
  const input = new Blob([new TextEncoder().encode(text)]).stream();
  const compressed = await readAll(
    input.pipeThrough(new CompressionStream('deflate-raw')),
    Number.POSITIVE_INFINITY,
  );
  // readAll only gives up past maxBytes, and there is none here.
  return PREFIX + toBase64Url(compressed ?? new Uint8Array());
}

/** Whether a URL hash is a share link. */
export function isShareHash(hash: string): boolean {
  return hash.startsWith(PREFIX);
}

/**
 * The invoice in a share link's hash. Undefined when the hash isn't a share
 * link. Stops decompressing past maxBytes, so a crafted link can't expand
 * into gigabytes.
 */
export async function readShareHash(
  hash: string,
  maxBytes: number,
): Promise<SharedInvoice | undefined> {
  if (!isShareHash(hash)) return undefined;
  const compressed = fromBase64Url(hash.slice(PREFIX.length));
  if (compressed === undefined) return { ok: false, reason: DAMAGED };
  let bytes: Uint8Array | undefined;
  try {
    bytes = await readAll(
      new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw')),
      maxBytes,
    );
  } catch {
    return { ok: false, reason: DAMAGED };
  }
  if (bytes === undefined) {
    const mb = (maxBytes / 1_000_000).toFixed(0);
    return {
      ok: false,
      reason: `The invoice in this share link is over ${mb} MB, so it wasn't opened.`,
    };
  }
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, reason: DAMAGED };
  }
}
