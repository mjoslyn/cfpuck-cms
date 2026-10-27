// Whether a /media/ path tries to leave the media folder: ".." segments or backslashes, plain or
// %-escaped (once or twice). Used by the /media/ route.
export function unsafeMediaPath(pathname: string): boolean {
  let p = pathname;
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(p);
      if (next === p) break;
      p = next;
    } catch {
      return true;
    }
  }
  return /(^|[/\\])\.\.([/\\]|$)/.test(p) || p.includes('\\') || /%(2e|5c|2f)/i.test(p);
}

/** Sent with every /media/ file: a stored file opened as a document (an SVG, say) can't run script on the site's address. */
export const MEDIA_HEADERS = { 'Content-Security-Policy': 'sandbox', 'X-Content-Type-Options': 'nosniff' };

const OFFICE = /^application\/(msword|vnd\.(ms-|openxmlformats-|oasis\.opendocument))/;

/**
 * The headers for a stored file of this type. A PDF is shown by the browser's own viewer, which a
 * sandboxed answer turns away (Chrome), so it goes without the sandbox: it can't run the site's script,
 * and nosniff keeps it a PDF (uploads check that it is one). Office and OpenDocument files download, with
 * their name.
 */
export function mediaHeaders(contentType: string | null, path: string): Record<string, string> {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (type === 'application/pdf') return { 'X-Content-Type-Options': 'nosniff' };
  if (OFFICE.test(type)) return { ...MEDIA_HEADERS, 'Content-Disposition': `attachment; filename="${(path.split('/').pop() ?? 'file').replace(/[^\w.-]/g, '_')}"` };
  return MEDIA_HEADERS;
}
