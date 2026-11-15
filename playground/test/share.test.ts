import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/examples.ts';
import { MAX_SHARE_URL_LENGTH, isShareHash, readShareHash, shareHash } from '../src/share.ts';

const MB5 = 5_000_000;

describe('share links', () => {
  it.each(EXAMPLES.map((e) => [e.id, e.text] as const))('round-trips %s', async (_id, text) => {
    const hash = await shareHash(text);
    expect(hash).toMatch(/^#invoice=[A-Za-z0-9_-]+$/);
    expect(hash.length).toBeLessThan(MAX_SHARE_URL_LENGTH / 10);
    await expect(readShareHash(hash, MB5)).resolves.toEqual({ ok: true, text });
  });

  it('keeps any Unicode text exactly', async () => {
    const text = '{"supplier": {"name": "Café Élan – 🧾"}, "note": "a\\"b\\\\c\\u0000"}\r\n';
    await expect(readShareHash(await shareHash(text), MB5)).resolves.toEqual({ ok: true, text });
  });

  it('compresses: a link is shorter than the invoice', async () => {
    const text = EXAMPLES[0]?.text ?? '';
    expect((await shareHash(text)).length).toBeLessThan(text.length);
  });

  it('ignores a hash that is not a share link', async () => {
    expect(isShareHash('')).toBe(false);
    expect(isShareHash('#results')).toBe(false);
    expect(isShareHash('#invoice=abc')).toBe(true);
    await expect(readShareHash('#results', MB5)).resolves.toBeUndefined();
  });

  it.each([
    ['not base64url', '#invoice=not*valid'],
    ['empty', '#invoice='],
    ['impossible base64 length', '#invoice=A'],
  ])('reports a damaged link: %s', async (_name, hash) => {
    const shared = await readShareHash(hash, MB5);
    expect(shared).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/damaged/) as unknown,
    });
  });

  it('reports a link that was cut off', async () => {
    const hash = await shareHash(EXAMPLES[0]?.text ?? '');
    const shared = await readShareHash(hash.slice(0, Math.floor(hash.length / 2)), MB5);
    expect(shared).toMatchObject({ ok: false });
  });

  it('stops decompressing past the size limit', async () => {
    const hash = await shareHash('a'.repeat(100_000));
    const shared = await readShareHash(hash, 10_000);
    expect(shared).toMatchObject({ ok: false, reason: expect.stringMatching(/over/) as unknown });
  });
});
