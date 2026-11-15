/**
 * Finds an issue's field ("lines[2].lineTotal") in the JSON text, so clicking
 * the issue can select it in the editor. JSON only: issues on a UBL invoice
 * name fields of the invoice model, not places in the XML. No DOM here.
 */

type JsonNode =
  | { kind: 'object'; start: number; end: number; members: Member[] }
  | { kind: 'array'; start: number; end: number; items: JsonNode[] }
  | { kind: 'scalar'; start: number; end: number };

interface Member {
  key: string;
  /** Where the key's opening quote is. */
  keyStart: number;
  value: JsonNode;
}

/** A range of the editor text; start === end is a caret. */
export interface FieldLocation {
  start: number;
  end: number;
  /**
   * False when the field isn't in the invoice. The range is then a caret
   * where it could be added (inside the nearest object or array on its path),
   * or that nearest value itself if it is neither.
   */
  found: boolean;
}

export type Locator = (field: string) => FieldLocation | undefined;

/** "lines[2].lineTotal" -> ["lines", 2, "lineTotal"]. Undefined for "" or a path it can't read. */
export function parseFieldPath(field: string): (string | number)[] | undefined {
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/.test(field)) return undefined;
  return Array.from(
    field.matchAll(/([A-Za-z_$][\w$]*)|\[(\d+)\]/g),
    ([, key, index]) => key ?? Number(index),
  );
}

/** A byte order mark, which a pasted file can start with. */
const BOM = String.fromCharCode(0xfeff);

/** Reads JSON that JSON.parse already accepted, keeping where each value is. */
class Scanner {
  private pos = 0;
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  document(): JsonNode {
    if (this.text.startsWith(BOM)) this.pos = 1;
    const root = this.value();
    this.space();
    if (this.pos !== this.text.length) throw new SyntaxError('trailing text');
    return root;
  }

  private space(): void {
    while (this.pos < this.text.length && ' \t\n\r'.includes(this.text.charAt(this.pos))) {
      this.pos += 1;
    }
  }

  private expect(char: string): void {
    this.space();
    if (this.text.charAt(this.pos) !== char) throw new SyntaxError(`expected ${char}`);
    this.pos += 1;
  }

  private value(): JsonNode {
    this.space();
    const start = this.pos;
    const char = this.text.charAt(this.pos);
    if (char === '{') return this.object();
    if (char === '[') return this.array();
    if (char === '"') {
      this.string();
      return { kind: 'scalar', start, end: this.pos };
    }
    // A number, true, false or null: runs to the next delimiter.
    while (this.pos < this.text.length && !' \t\n\r,]}'.includes(this.text.charAt(this.pos))) {
      this.pos += 1;
    }
    if (this.pos === start) throw new SyntaxError('expected a value');
    return { kind: 'scalar', start, end: this.pos };
  }

  private string(): string {
    const start = this.pos;
    this.pos += 1;
    while (this.pos < this.text.length) {
      const char = this.text.charAt(this.pos);
      if (char === '\\') this.pos += 2;
      else if (char === '"') {
        this.pos += 1;
        return JSON.parse(this.text.slice(start, this.pos)) as string;
      } else this.pos += 1;
    }
    throw new SyntaxError('unterminated string');
  }

  private object(): JsonNode {
    const start = this.pos;
    this.pos += 1;
    const members: Member[] = [];
    this.space();
    if (this.text.charAt(this.pos) === '}') {
      this.pos += 1;
      return { kind: 'object', start, end: this.pos, members };
    }
    for (;;) {
      this.space();
      const keyStart = this.pos;
      if (this.text.charAt(this.pos) !== '"') throw new SyntaxError('expected a key');
      const key = this.string();
      this.expect(':');
      members.push({ key, keyStart, value: this.value() });
      this.space();
      const next = this.text.charAt(this.pos);
      this.pos += 1;
      if (next === '}') return { kind: 'object', start, end: this.pos, members };
      if (next !== ',') throw new SyntaxError('expected , or }');
    }
  }

  private array(): JsonNode {
    const start = this.pos;
    this.pos += 1;
    const items: JsonNode[] = [];
    this.space();
    if (this.text.charAt(this.pos) === ']') {
      this.pos += 1;
      return { kind: 'array', start, end: this.pos, items };
    }
    for (;;) {
      items.push(this.value());
      this.space();
      const next = this.text.charAt(this.pos);
      this.pos += 1;
      if (next === ']') return { kind: 'array', start, end: this.pos, items };
      if (next !== ',') throw new SyntaxError('expected , or ]');
    }
  }
}

/** Where a missing child of this value could be added. */
function insertionPoint(node: JsonNode): FieldLocation {
  if (node.kind === 'scalar') return { start: node.start, end: node.end, found: false };
  const last = node.kind === 'object' ? node.members.at(-1)?.value : node.items.at(-1);
  const at = last === undefined ? node.start + 1 : last.end;
  return { start: at, end: at, found: false };
}

/**
 * A locator for this text. It reads the JSON once, on first use, and returns
 * undefined for every field when the text isn't valid JSON.
 */
export function fieldLocator(text: string): Locator {
  let root: JsonNode | null | undefined;
  const parse = (): JsonNode | null => {
    try {
      // The scanner skips a byte order mark too.
      JSON.parse(text.startsWith(BOM) ? text.slice(1) : text);
      return new Scanner(text).document();
    } catch {
      return null;
    }
  };
  return (field) => {
    const path = parseFieldPath(field);
    if (path === undefined) return undefined;
    root ??= parse();
    if (root === null) return undefined;
    let node = root;
    let start = root.start;
    for (const step of path) {
      let next: JsonNode | undefined;
      let nextStart = 0;
      if (typeof step === 'string' && node.kind === 'object') {
        // JSON.parse keeps the last of duplicate keys, so the checks saw that one.
        const member = node.members.findLast((m) => m.key === step);
        if (member !== undefined) {
          next = member.value;
          nextStart = member.keyStart;
        }
      } else if (typeof step === 'number' && node.kind === 'array') {
        next = node.items[step];
        nextStart = next?.start ?? 0;
      }
      if (next === undefined) return insertionPoint(node);
      node = next;
      start = nextStart;
    }
    return { start, end: node.end, found: true };
  };
}

/** Where the field is in the text; see fieldLocator. */
export function locateField(text: string, field: string): FieldLocation | undefined {
  return fieldLocator(text)(field);
}
