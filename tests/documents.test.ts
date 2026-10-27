// Documents in the media library (src/lib/media/documents.ts): which files are taken and as what, the
// check that a file is what its name says, how /media/ serves them, and the File block.
import { describe, expect, it } from 'vitest';
import { contentMatches, docLabel, docType, fileSize, isDocument } from '../src/lib/media/documents';
import { mediaHeaders } from '../src/lib/media/path-guard';
import { file } from '../src/render/c/content';

const bytes = (s: string | number[]) => (typeof s === 'string' ? new TextEncoder().encode(s) : new Uint8Array(s));

describe('documents', () => {
  it('takes office documents, PDFs and text by their ending', () => {
    expect(docType('Annual Report.PDF')?.mime).toBe('application/pdf');
    expect(docType('budget.xlsx')?.label).toBe('Excel');
    expect(docType('page.html')).toBeNull();
    expect(docType('image.svg')).toBeNull();
    expect(isDocument('application/pdf')).toBe(true);
    expect(isDocument('image/png')).toBe(false);
    expect(docLabel('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('Word');
  });

  it('refuses a file whose content isn\'t what its name says', () => {
    expect(contentMatches('a.pdf', bytes('%PDF-1.7\n...'))).toBe(true);
    expect(contentMatches('a.pdf', bytes('<html><script>alert(1)</script>'))).toBe(false);
    expect(contentMatches('a.docx', bytes([0x50, 0x4b, 0x03, 0x04, 1, 2]))).toBe(true);
    expect(contentMatches('a.docx', bytes('%PDF-1.7'))).toBe(false);
    expect(contentMatches('a.doc', bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]))).toBe(true);
    expect(contentMatches('notes.txt', bytes('Meeting at 7pm.\nBring chairs.'))).toBe(true);
    expect(contentMatches('notes.txt', bytes('  <!DOCTYPE html><html>'))).toBe(false);
    expect(contentMatches('data.csv', bytes([0x61, 0x00, 0x62]))).toBe(false);
  });

  it('writes sizes as people read them', () => {
    expect(fileSize(512)).toBe('512 bytes');
    expect(fileSize(2048)).toBe('2 KB');
    expect(fileSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(fileSize(null)).toBe('');
  });

  it('serves a PDF for the browser\'s viewer, office files as downloads, the rest sandboxed', () => {
    expect(mediaHeaders('application/pdf', '2026/10/report.pdf')).toEqual({ 'X-Content-Type-Options': 'nosniff' });
    const word = mediaHeaders('application/vnd.openxmlformats-officedocument.wordprocessingml.document', '2026/10/minutes "draft".docx');
    expect(word['Content-Disposition']).toBe('attachment; filename="minutes__draft_.docx"');
    expect(word['Content-Security-Policy']).toBe('sandbox');
    expect(mediaHeaders('image/svg+xml', 'a.svg')['Content-Security-Policy']).toBe('sandbox');
    expect(mediaHeaders('text/plain; charset=utf-8', 'a.txt')['Content-Security-Policy']).toBe('sandbox');
  });

  it('renders the File block: link, type and size, and Download', () => {
    const env = { ctx: { loader: { media: new Map([[3, { id: 3, path: '2026/10/report.pdf', mime_type: 'application/pdf', title: 'Annual report', filesize: 1258291 }]]) } } } as any;
    const render = (attrs: Record<string, unknown>) => file({ type: 'file', attrs, id: 'f' } as any, env, (() => '') as any);
    const html = render({ mediaId: 3 });
    expect(html).toContain('<a class="c-file__link" href="/media/2026/10/report.pdf">Annual report</a>');
    expect(html).toContain('<span class="c-file__meta">PDF · 1.2 MB</span>');
    expect(html).toContain('download aria-label="Download: Annual report">Download</a>');
    expect(render({ mediaId: 3, label: 'Read the report', details: false, button: '' })).toBe('<div class="c-file"><a class="c-file__link" href="/media/2026/10/report.pdf">Read the report</a></div>');
    expect(render({ href: 'https://example.org/a.pdf' })).toContain('>a.pdf</a>');
    expect(render({})).toBe('');
  });
});
