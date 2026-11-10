/**
 * Safe, namespace-aware XML reading on top of fast-xml-parser.
 *
 * Security policy (see docs/decisions.md):
 * - Inputs over `maxBytes` (default 5 MB) are rejected before parsing.
 * - Any DOCTYPE or ENTITY declaration is rejected before parsing. UBL never
 *   needs a DTD, so this rules out XXE and entity-expansion ("billion laughs")
 *   attacks regardless of parser settings.
 * - The parser's own entity processing is off. The five predefined XML
 *   entities and numeric character references are decoded here, in one pass,
 *   so "&amp;#233;" stays the literal text "&#233;". CDATA is never decoded.
 * - Nesting deeper than `maxDepth` is rejected.
 *
 * Elements are identified by namespace URI + local name, never by prefix.
 */
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { Issue } from '../types.ts';

/** Default maximum XML input size: 5 MB. */
export const DEFAULT_MAX_XML_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_XML_DEPTH = 100;

/** Rule IDs of issues the XML layer can report. */
export const XML_ISSUES = {
  /** Not well-formed XML (or an undeclared namespace prefix). */
  MALFORMED: 'PARSE-UBL-002',
  /** DOCTYPE / ENTITY declarations are not accepted. */
  DTD: 'PARSE-UBL-003',
  /** Input larger than the configured limit. */
  TOO_LARGE: 'PARSE-UBL-004',
} as const;

export interface XmlElement {
  /** Namespace URI ('' when the element is in no namespace). */
  ns: string;
  /** Local name, without prefix. */
  local: string;
  /** Attributes by local name (namespace declarations excluded). */
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Concatenated text content of this element (not descendants), trimmed. */
  text: string;
}

export type XmlParseResult = { ok: true; root: XmlElement } | { ok: false; issues: Issue[] };

export interface XmlOptions {
  maxBytes?: number;
  maxDepth?: number;
}

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const CDATA_KEY = '__cdata';
const ATTRS_KEY = ':@';
const TEXT_KEY = '#text';
const ATTR_PREFIX = '@_';

function fail(ruleId: string, message: string, fix?: string): XmlParseResult {
  return {
    ok: false,
    issues: [{ ruleId, severity: 'error', field: '', message, ...(fix ? { fix } : {}) }],
  };
}

/** Decode predefined entities and numeric character references in one pass. */
export function decodeXmlText(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(
    /&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g,
    (match, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
      if (name !== undefined) {
        return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name] ?? match;
      }
      const code = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex ?? '', 16);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    },
  );
}

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

type RawNode = Record<string, unknown>;

const isRecord = (v: unknown): v is RawNode =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

class UnboundPrefixError extends Error {}

function collectText(nodes: unknown[]): string {
  let out = '';
  for (const node of nodes) {
    if (!isRecord(node)) continue;
    const t = node[TEXT_KEY];
    if (typeof t === 'string') out += decodeXmlText(t);
    const cdata = node[CDATA_KEY];
    if (Array.isArray(cdata)) {
      for (const c of cdata) {
        if (isRecord(c) && typeof c[TEXT_KEY] === 'string') out += c[TEXT_KEY];
      }
    }
  }
  return out.trim();
}

function buildElement(node: RawNode, scope: ReadonlyMap<string, string>): XmlElement | undefined {
  const tagName = Object.keys(node).find(
    (k) => k !== ATTRS_KEY && k !== TEXT_KEY && k !== CDATA_KEY,
  );
  if (tagName === undefined) return undefined;
  const rawChildren = node[tagName];
  const rawAttrs = isRecord(node[ATTRS_KEY]) ? node[ATTRS_KEY] : {};

  // Namespace declarations on this element extend the inherited scope.
  const localScope = new Map(scope);
  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawAttrs)) {
    const name = key.startsWith(ATTR_PREFIX) ? key.slice(ATTR_PREFIX.length) : key;
    const v = decodeXmlText(typeof value === 'string' ? value : String(value));
    if (name === 'xmlns') localScope.set('', v);
    else if (name.startsWith('xmlns:')) localScope.set(name.slice('xmlns:'.length), v);
    else attrs[name.includes(':') ? name.slice(name.indexOf(':') + 1) : name] = v;
  }

  const colon = tagName.indexOf(':');
  const prefix = colon === -1 ? '' : tagName.slice(0, colon);
  const local = colon === -1 ? tagName : tagName.slice(colon + 1);
  const ns = localScope.get(prefix);
  if (ns === undefined && prefix !== '') throw new UnboundPrefixError(prefix);

  const childNodes = Array.isArray(rawChildren) ? (rawChildren as unknown[]) : [];
  const children: XmlElement[] = [];
  for (const child of childNodes) {
    if (!isRecord(child)) continue;
    const el = buildElement(child, localScope);
    if (el) children.push(el);
  }
  return { ns: ns ?? '', local, attrs, children, text: collectText(childNodes) };
}

const NOT_WELL_FORMED_FIX = 'Check the file was exported completely and is valid XML.';

/** Parse XML into a namespace-aware element tree, or explain why not. */
export function parseXml(input: string, options: XmlOptions = {}): XmlParseResult {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_XML_BYTES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_XML_DEPTH;

  // UTF-16 length never exceeds UTF-8 byte length, so this cheap check is safe.
  if (input.length > maxBytes || utf8Length(input) > maxBytes) {
    return fail(
      XML_ISSUES.TOO_LARGE,
      `The file is larger than the ${Math.round(maxBytes / 1024 / 1024)} MB limit for XML invoices.`,
      'Check this is a single invoice. The limit can be raised with the maxXmlBytes option.',
    );
  }

  const xml = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    return fail(
      XML_ISSUES.DTD,
      'The XML contains a DOCTYPE or ENTITY declaration. UBL invoices never need one, and they are refused for security (they enable XXE and entity-expansion attacks).',
      'Remove the DOCTYPE/ENTITY declarations from the file.',
    );
  }

  // XMLValidator is deprecated in fast-xml-parser 5.x in favour of the separate
  // fast-xml-validator package. It still ships and works; switching is tracked in
  // docs/decisions.md for the fast-xml-parser 6 upgrade.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const valid = XMLValidator.validate(xml, { allowBooleanAttributes: false });
  if (valid !== true) {
    const { msg, line, col } = valid.err;
    // The validator leaves out the position it doesn't know (e.g. the column
    // for a file that is only an XML declaration).
    const position = [
      ...(typeof line === 'number' ? [`line ${line}`] : []),
      ...(typeof col === 'number' ? [`column ${col}`] : []),
    ].join(', ');
    return fail(
      XML_ISSUES.MALFORMED,
      `The file is not well-formed XML${position === '' ? '' : ` (${position})`}: ${msg}`,
      NOT_WELL_FORMED_FIX,
    );
  }

  let parsed: unknown;
  try {
    parsed = new XMLParser({
      preserveOrder: true,
      ignoreAttributes: false,
      attributeNamePrefix: ATTR_PREFIX,
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: true,
      ignoreDeclaration: true,
      ignorePiTags: true,
      processEntities: false,
      htmlEntities: false,
      cdataPropName: CDATA_KEY,
      maxNestedTags: maxDepth,
    }).parse(xml);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (/nested tags/i.test(detail)) {
      return fail(
        XML_ISSUES.MALFORMED,
        `The XML is nested more than ${maxDepth} elements deep, which is far deeper than any UBL invoice.`,
        'Check this is a UBL invoice and that it was exported correctly.',
      );
    }
    return fail(XML_ISSUES.MALFORMED, `The XML could not be read: ${detail}.`, NOT_WELL_FORMED_FIX);
  }

  const top = Array.isArray(parsed) ? (parsed as unknown[]).filter(isRecord) : [];
  const rootNodes = top.filter((n) =>
    Object.keys(n).some((k) => k !== ATTRS_KEY && k !== TEXT_KEY),
  );
  const rootNode = rootNodes[0];
  if (rootNode === undefined) {
    return fail(XML_ISSUES.MALFORMED, 'The XML has no root element.', NOT_WELL_FORMED_FIX);
  }
  try {
    const root = buildElement(rootNode, new Map([['xml', XML_NS]]));
    if (!root) {
      return fail(XML_ISSUES.MALFORMED, 'The XML has no root element.', NOT_WELL_FORMED_FIX);
    }
    return { ok: true, root };
  } catch (err) {
    if (err instanceof UnboundPrefixError) {
      return fail(
        XML_ISSUES.MALFORMED,
        `The XML uses the namespace prefix "${err.message}" without declaring it.`,
        'Add the missing xmlns declaration.',
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

/** First child with this namespace and local name. */
export function child(
  el: XmlElement | undefined,
  ns: string,
  local: string,
): XmlElement | undefined {
  return el?.children.find((c) => c.ns === ns && c.local === local);
}

/** All children with this namespace and local name. */
export function children(el: XmlElement | undefined, ns: string, local: string): XmlElement[] {
  return el?.children.filter((c) => c.ns === ns && c.local === local) ?? [];
}

/** Follow a path of [ns, local] steps, taking the first match at each step. */
export function path(
  el: XmlElement | undefined,
  ...steps: readonly (readonly [string, string])[]
): XmlElement | undefined {
  let current = el;
  for (const [ns, local] of steps) current = child(current, ns, local);
  return current;
}

/** Text of an element, or undefined when absent or empty. */
export function textOf(el: XmlElement | undefined): string | undefined {
  return el === undefined || el.text === '' ? undefined : el.text;
}
