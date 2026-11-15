/**
 * invoicelint playground: an editor on the left, findings on the right.
 * Everything runs in this page; nothing is sent anywhere.
 */
// First, before anything that uses zod.
import './csp.ts';
import './style.css';
import {
  DEFAULT_MAX_XML_BYTES,
  VERSION,
  decodeInvoiceBytes,
  detectFormat,
  fieldLabel,
} from '../../src/index.ts';
import { FORMAT_LABEL, announcement, checkInvoice } from './check.ts';
import { DEFAULT_EXAMPLE_ID, EXAMPLES, exampleById } from './examples.ts';
import { fieldLocator, locateField } from './locate.ts';
import { renderResults } from './render.ts';
import { MAX_SHARE_URL_LENGTH, isShareHash, readShareHash, shareHash } from './share.ts';

/** Validate this long after the last keystroke. */
const DEBOUNCE_MS = 300;
/** Same cap as the library's XML limit, so a huge file can't freeze the page. */
const MAX_FILE_BYTES = DEFAULT_MAX_XML_BYTES;
/** How long the share button says "Link copied". */
const COPIED_MS = 2000;
const RELEASES_URL = 'https://github.com/larplarp67/invoicelint/releases';

function must<T extends Element>(selector: string, type: abstract new () => T): T {
  const el = document.querySelector(selector);
  if (!(el instanceof type)) throw new Error(`playground: missing ${selector}`);
  return el;
}

const editor = must('#editor', HTMLTextAreaElement);
const results = must('#results', HTMLElement);
const formatChip = must('#format', HTMLElement);
const fileName = must('#file-name', HTMLElement);
const notice = must('#notice', HTMLElement);
const hint = must('#hint', HTMLElement);
const live = must('#live', HTMLElement);
const examples = must('#examples', HTMLSelectElement);
const openButton = must('#open', HTMLButtonElement);
const shareButton = must('#share', HTMLButtonElement);
const fileInput = must('#file', HTMLInputElement);
const version = must('#version', HTMLAnchorElement);

let timer: ReturnType<typeof setTimeout> | undefined;
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
let infoOpen = false;
let lastAnnouncement = '';
/** The editor text as last loaded (example, file or share link), to tell whether it has been edited since. */
let loadedText = '';

version.textContent = `v${VERSION}`;
version.href = `${RELEASES_URL}/tag/v${VERSION}`;
version.hidden = false;

for (const example of EXAMPLES) {
  examples.append(new Option(example.label, example.id));
}

function showFormat(): void {
  const text = editor.value;
  const empty = text.trim() === '';
  formatChip.textContent = empty ? 'Empty' : FORMAT_LABEL[detectFormat(text)];
  shareButton.disabled = empty;
}

function setNotice(message: string): void {
  notice.textContent = message;
  notice.hidden = message === '';
}

function setHint(message: string): void {
  hint.textContent = message;
  hint.hidden = message === '';
}

/** Scroll the editor so this offset is about a third of the way down. */
function scrollEditorTo(offset: number): void {
  let line = 0;
  for (
    let i = editor.value.indexOf('\n');
    i !== -1 && i < offset;
    i = editor.value.indexOf('\n', i + 1)
  ) {
    line += 1;
  }
  const style = getComputedStyle(editor);
  const lineHeight = Number.parseFloat(style.lineHeight) || 20;
  const top = (Number.parseFloat(style.paddingTop) || 0) + line * lineHeight;
  editor.scrollTop = Math.max(0, top - editor.clientHeight / 3);
  editor.scrollLeft = 0;
}

/** Select an issue's field in the editor, or put the cursor where a missing one could go. */
function showField(field: string): void {
  // Read the editor as it is now: it may have changed since the results were drawn.
  const location = locateField(editor.value, field);
  if (location === undefined) return;
  // On a phone the editor is above the results.
  editor.scrollIntoView({ block: 'nearest' });
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(location.start, location.end);
  scrollEditorTo(location.start);
  const label = fieldLabel(field) || field;
  if (location.found) setHint('');
  else if (location.start === location.end) {
    setHint(`${label} isn't in this invoice. The cursor is where you could add it.`);
  } else setHint(`${label} isn't in this invoice.`);
}

function run(): void {
  clearTimeout(timer);
  const text = editor.value;
  const outcome = checkInvoice(text);
  const locator =
    outcome.kind === 'checked' && outcome.format === 'json' ? fieldLocator(text) : undefined;
  renderResults(results, outcome, {
    infoOpen,
    onInfoToggle: (open) => {
      infoOpen = open;
    },
    ...(locator === undefined
      ? {}
      : {
          fieldLink: {
            canShow: (field) => locator(field) !== undefined,
            show: showField,
          },
        }),
  });
  const message = announcement(outcome);
  if (message !== lastAnnouncement) {
    live.textContent = message;
    lastAnnouncement = message;
  }
}

/** The address bar keeps a share link only while the editor still shows that invoice. */
function dropShareHash(): void {
  if (isShareHash(location.hash)) {
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  }
}

interface LoadOptions {
  /** Shown next to the format: a file name, or where the invoice came from. */
  name: string;
  /** The example menu entry this is, if any. */
  exampleId?: string;
  /** Keep a share link in the address bar (the invoice came from it). */
  keepHash?: boolean;
}

function load(text: string, options: LoadOptions): void {
  editor.value = text;
  // Read back: the textarea turns \r\n into \n.
  loadedText = editor.value;
  editor.scrollTop = 0;
  editor.scrollLeft = 0;
  fileName.textContent = options.name;
  examples.value = options.exampleId ?? '';
  setNotice('');
  setHint('');
  if (options.keepHash !== true) dropShareHash();
  showFormat();
  run();
}

function loadExample(id: string): void {
  const example = exampleById(id);
  if (example !== undefined) load(example.text, { name: '', exampleId: example.id });
}

/** Whether the editor holds text someone typed or pasted since the last load. An empty editor has nothing to lose. */
function hasEdits(): boolean {
  return editor.value !== loadedText && editor.value.trim() !== '';
}

async function loadFile(file: File): Promise<void> {
  if (file.size > MAX_FILE_BYTES) {
    const mb = (file.size / 1_000_000).toFixed(1);
    setNotice(`${file.name} is ${mb} MB. The playground opens files up to 5 MB.`);
    return;
  }
  const decoded = decodeInvoiceBytes(new Uint8Array(await file.arrayBuffer()));
  if (!decoded.ok) {
    setNotice(`Couldn't open ${file.name}: ${decoded.reason}.`);
    return;
  }
  load(decoded.text, { name: file.name });
}

/** Open the invoice in the address bar's share link. False if there isn't one. */
async function loadFromHash(): Promise<boolean> {
  const shared = await readShareHash(location.hash, MAX_FILE_BYTES);
  if (shared === undefined) return false;
  if (shared.ok) {
    load(shared.text, { name: 'From a share link', keepHash: true });
  } else {
    if (editor.value === '') loadExample(DEFAULT_EXAMPLE_ID);
    dropShareHash();
    setNotice(shared.reason);
  }
  return true;
}

function flashCopied(): void {
  clearTimeout(copiedTimer);
  shareButton.textContent = 'Link copied';
  live.textContent = 'Share link copied.';
  lastAnnouncement = '';
  copiedTimer = setTimeout(() => {
    shareButton.textContent = 'Copy share link';
  }, COPIED_MS);
}

async function copyShareLink(): Promise<void> {
  const text = editor.value;
  if (text.trim() === '') return;
  const url = new URL(location.href);
  url.hash = await shareHash(text);
  if (url.href.length > MAX_SHARE_URL_LENGTH) {
    const kb = Math.ceil(url.href.length / 1000);
    setNotice(
      `This invoice makes a ${kb} KB link, too long to share reliably. Send the file instead.`,
    );
    return;
  }
  setNotice('');
  try {
    await navigator.clipboard.writeText(url.href);
    flashCopied();
  } catch {
    // No clipboard access (an insecure page, or the browser said no): use the address bar.
    history.replaceState(null, '', url.hash);
    setHint(
      "Couldn't copy the link automatically. It's in the address bar now: copy it from there.",
    );
  }
}

editor.addEventListener('input', () => {
  fileName.textContent = '';
  examples.value = '';
  setHint('');
  dropShareHash();
  showFormat();
  clearTimeout(timer);
  timer = setTimeout(run, DEBOUNCE_MS);
});

examples.addEventListener('change', () => {
  const example = exampleById(examples.value);
  if (example === undefined) return;
  if (
    hasEdits() &&
    !window.confirm(
      `Replace your edited invoice with the example "${example.label}"? Your edits will be lost.`,
    )
  ) {
    examples.value = '';
    return;
  }
  loadExample(example.id);
});

openButton.addEventListener('click', () => {
  fileInput.click();
});
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (file !== undefined) void loadFile(file);
});

shareButton.addEventListener('click', () => {
  void copyShareLink();
});

// Pasting another share link into the address bar of an open tab changes only the hash.
window.addEventListener('hashchange', () => {
  void loadFromHash();
});

// Drop a file anywhere on the page. Dropping text into the editor still works as usual.
const hasFiles = (e: DragEvent): boolean => e.dataTransfer?.types.includes('Files') === true;
let dragDepth = 0;
const setDragging = (on: boolean): void => {
  document.body.classList.toggle('is-dragging', on);
};
document.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth += 1;
  setDragging(true);
});
document.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  if (e.dataTransfer !== null) e.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) setDragging(false);
});
document.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  setDragging(false);
  const file = e.dataTransfer?.files[0];
  if (file !== undefined) void loadFile(file);
});

void loadFromHash().then((loaded) => {
  if (!loaded) loadExample(DEFAULT_EXAMPLE_ID);
});
