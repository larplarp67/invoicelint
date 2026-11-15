/**
 * invoicelint playground: an editor on the left, findings on the right.
 * Everything runs in this page; nothing is sent anywhere.
 */
import './style.css';
import { DEFAULT_MAX_XML_BYTES, decodeInvoiceBytes, detectFormat } from '../../src/index.ts';
import { FORMAT_LABEL, announcement, checkInvoice } from './check.ts';
import { DEFAULT_EXAMPLE } from './examples.ts';
import { renderResults } from './render.ts';

/** Validate this long after the last keystroke. */
const DEBOUNCE_MS = 300;
/** Same cap as the library's XML limit, so a huge file can't freeze the page. */
const MAX_FILE_BYTES = DEFAULT_MAX_XML_BYTES;

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
const live = must('#live', HTMLElement);
const openButton = must('#open', HTMLButtonElement);
const fileInput = must('#file', HTMLInputElement);

let timer: ReturnType<typeof setTimeout> | undefined;
let infoOpen = false;
let lastAnnouncement = '';

function showFormat(): void {
  const text = editor.value;
  formatChip.textContent = text.trim() === '' ? 'Empty' : FORMAT_LABEL[detectFormat(text)];
}

function run(): void {
  clearTimeout(timer);
  const outcome = checkInvoice(editor.value);
  renderResults(results, outcome, {
    infoOpen,
    onInfoToggle: (open) => {
      infoOpen = open;
    },
  });
  const message = announcement(outcome);
  if (message !== lastAnnouncement) {
    live.textContent = message;
    lastAnnouncement = message;
  }
}

function setNotice(message: string): void {
  notice.textContent = message;
  notice.hidden = message === '';
}

function load(text: string, name: string): void {
  editor.value = text;
  fileName.textContent = name;
  setNotice('');
  showFormat();
  run();
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
  load(decoded.text, file.name);
}

editor.addEventListener('input', () => {
  fileName.textContent = '';
  showFormat();
  clearTimeout(timer);
  timer = setTimeout(run, DEBOUNCE_MS);
});

openButton.addEventListener('click', () => {
  fileInput.click();
});
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (file !== undefined) void loadFile(file);
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

load(DEFAULT_EXAMPLE.text, DEFAULT_EXAMPLE.name);
