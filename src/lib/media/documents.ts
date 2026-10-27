// Documents in the media library (PDF, Word, Excel, PowerPoint, OpenDocument, plain text, CSV): which
// files are taken, the type each is stored and served as (from its ending, since browsers report Office
// files' types unevenly), and a check of the file's first bytes, so a file named .pdf that is really a
// web page is refused. Safe in the browser.

/** By ending: the type it is stored as, and a short label. */
export const DOC_TYPES: Record<string, { mime: string; label: string }> = {
  pdf: { mime: 'application/pdf', label: 'PDF' },
  doc: { mime: 'application/msword', label: 'Word' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word' },
  xls: { mime: 'application/vnd.ms-excel', label: 'Excel' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Excel' },
  ppt: { mime: 'application/vnd.ms-powerpoint', label: 'PowerPoint' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', label: 'PowerPoint' },
  odt: { mime: 'application/vnd.oasis.opendocument.text', label: 'Document' },
  ods: { mime: 'application/vnd.oasis.opendocument.spreadsheet', label: 'Spreadsheet' },
  odp: { mime: 'application/vnd.oasis.opendocument.presentation', label: 'Presentation' },
  txt: { mime: 'text/plain', label: 'Text' },
  csv: { mime: 'text/csv', label: 'CSV' },
};

/** The largest document taken (uploads are read whole, and the Worker has 128 MB). */
export const DOC_MAX_MB = 50;

/** For a file input's accept. */
export const DOC_ACCEPT = Object.keys(DOC_TYPES).map((e) => `.${e}`).join(',');

const ending = (name: string) => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';

/** The document type for a file name, if the library takes it. */
export const docType = (name: string) => DOC_TYPES[ending(name)] ?? null;

/** Whether a stored type is one of the documents (not an image or video). */
export const isDocument = (mime: string | null | undefined) => Object.values(DOC_TYPES).some((t) => t.mime === mime);

/** The label for a stored document's type ("PDF"), else its ending in capitals. */
export function docLabel(mime: string | null | undefined, path = ''): string {
  return Object.values(DOC_TYPES).find((t) => t.mime === mime)?.label ?? (ending(path).toUpperCase() || 'File');
}

/** A size in bytes as people read it ("1.4 MB"). */
export function fileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

const starts = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

/** Whether the file's first bytes match what its ending says it is. */
export function contentMatches(name: string, bytes: Uint8Array): boolean {
  const e = ending(name);
  if (e === 'pdf') return starts(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
  if (['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'].includes(e)) return starts(bytes, [0x50, 0x4b, 0x03, 0x04]); // a zip
  if (['doc', 'xls', 'ppt'].includes(e)) return starts(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // OLE2
  if (e === 'txt' || e === 'csv') {
    // Text, not markup a browser could take for a page.
    const head = new TextDecoder().decode(bytes.slice(0, 1024)).trimStart().toLowerCase();
    return !bytes.slice(0, 8192).includes(0) && !/^<(!doctype|html|head|body|script|svg|\?xml)/.test(head);
  }
  return false;
}
