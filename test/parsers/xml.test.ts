import { describe, expect, it } from 'vitest';
import {
  type XmlElement,
  child,
  decodeXmlText,
  parseXml,
  path,
  textOf,
} from '../../src/parsers/xml.ts';

const root = (xml: string, opts?: Parameters<typeof parseXml>[1]): XmlElement => {
  const r = parseXml(xml, opts);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.root;
};
const issueIds = (xml: string, opts?: Parameters<typeof parseXml>[1]): string[] => {
  const r = parseXml(xml, opts);
  return r.ok ? [] : r.issues.map((i) => i.ruleId);
};

describe('namespaces: matched by URI, never by prefix', () => {
  const A = 'urn:example:a';
  it.each([
    ['prefixed', `<x:Doc xmlns:x="${A}"><x:Name>n</x:Name></x:Doc>`],
    ['default namespace', `<Doc xmlns="${A}"><Name>n</Name></Doc>`],
    ['unusual prefix', `<zz:Doc xmlns:zz="${A}"><zz:Name>n</zz:Name></zz:Doc>`],
    ['redeclared on child', `<Doc xmlns="${A}"><q:Name xmlns:q="${A}">n</q:Name></Doc>`],
  ])('%s', (_label, xml) => {
    const doc = root(xml);
    expect(doc).toMatchObject({ ns: A, local: 'Doc' });
    expect(textOf(child(doc, A, 'Name'))).toBe('n');
  });

  it('does not match the same local name in another namespace', () => {
    const doc = root(`<Doc xmlns="${A}" xmlns:o="urn:other"><o:Name>wrong</o:Name></Doc>`);
    expect(child(doc, A, 'Name')).toBeUndefined();
    expect(textOf(child(doc, 'urn:other', 'Name'))).toBe('wrong');
  });

  it('reports an undeclared prefix', () => {
    expect(issueIds('<x:Doc/>')).toEqual(['PARSE-UBL-002']);
  });

  it('keeps attributes (unprefixed, by local name) and drops xmlns declarations', () => {
    const doc = root(`<Doc xmlns="${A}"><Amt currencyID="CAD">12.50</Amt></Doc>`);
    expect(child(doc, A, 'Amt')).toMatchObject({ attrs: { currencyID: 'CAD' }, text: '12.50' });
    expect(doc.attrs).toEqual({});
  });

  it('follows paths', () => {
    const doc = root(`<a xmlns="${A}"><b><c>deep</c></b></a>`);
    expect(textOf(path(doc, [A, 'b'], [A, 'c']))).toBe('deep');
    expect(path(doc, [A, 'b'], [A, 'missing'])).toBeUndefined();
  });
});

describe('text decoding', () => {
  it('decodes predefined entities and numeric references in one pass', () => {
    expect(decodeXmlText('AT&amp;T caf&#233; &#x2014; &lt;b&gt; &quot;q&quot; &apos;')).toBe(
      'AT&T café — <b> "q" \'',
    );
    // An escaped ampersand followed by "#233;" is literal text, not é.
    expect(decodeXmlText('&amp;#233;')).toBe('&#233;');
  });

  it('decodes element text and attributes, leaves CDATA alone, keeps strings as strings', () => {
    const doc = root(
      '<d a="x&amp;y"><n>Qu&#233;bec</n><c><![CDATA[a &amp; <b>]]></c><v>007.10</v></d>',
    );
    expect(doc.attrs.a).toBe('x&y');
    expect(textOf(child(doc, '', 'n'))).toBe('Québec');
    expect(textOf(child(doc, '', 'c'))).toBe('a &amp; <b>');
    expect(textOf(child(doc, '', 'v'))).toBe('007.10'); // never parsed as a number
  });

  it('strips a UTF-8 byte-order mark', () => {
    const bom = String.fromCharCode(0xfeff);
    expect(root(`${bom}<?xml version="1.0"?><d/>`).local).toBe('d');
  });
});

describe('security', () => {
  it('rejects a billion-laughs payload before parsing', () => {
    const lol = `<?xml version="1.0"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<Invoice>&lol3;</Invoice>`;
    const r = parseXml(lol);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toEqual([
        expect.objectContaining({ ruleId: 'PARSE-UBL-003', severity: 'error', field: '' }),
      ]);
      expect(r.issues[0]?.message).toMatch(/DOCTYPE or ENTITY/);
    }
  });

  it('rejects an XXE payload (external entity) before parsing', () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>`;
    expect(issueIds(xxe)).toEqual(['PARSE-UBL-003']);
  });

  it('rejects an external DTD reference', () => {
    expect(issueIds('<!DOCTYPE Invoice SYSTEM "http://evil.example/x.dtd"><Invoice/>')).toEqual([
      'PARSE-UBL-003',
    ]);
  });

  it('enforces the size limit (default 5 MB, configurable)', () => {
    const big = `<d>${'x'.repeat(5 * 1024 * 1024)}</d>`;
    expect(issueIds(big)).toEqual(['PARSE-UBL-004']);
    expect(issueIds('<d>12345</d>', { maxBytes: 10 })).toEqual(['PARSE-UBL-004']);
    expect(issueIds('<d>1</d>', { maxBytes: 10 })).toEqual([]);
  });

  it('counts the limit in UTF-8 bytes, not characters', () => {
    const accented = `<d>${'é'.repeat(8)}</d>`; // 15 characters, 23 bytes
    expect(issueIds(accented, { maxBytes: 20 })).toEqual(['PARSE-UBL-004']);
  });

  it('rejects excessive nesting', () => {
    const deep = '<a>'.repeat(150) + '</a>'.repeat(150);
    expect(issueIds(deep)).toEqual(['PARSE-UBL-002']);
    expect(issueIds(deep, { maxDepth: 200 })).toEqual([]);
  });
});

describe('malformed input', () => {
  it.each(['', 'not xml', '<a><b></a>', '<a>', '<a></a><b></b>'])(
    'reports %j as PARSE-UBL-002 with a position',
    (xml) => {
      const r = parseXml(xml);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issues[0]?.ruleId).toBe('PARSE-UBL-002');
    },
  );
});
