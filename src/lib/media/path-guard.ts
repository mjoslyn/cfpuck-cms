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
