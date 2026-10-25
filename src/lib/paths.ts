// Path prefixes that moved (the site's src/site/moved-paths.json: [old, new] pairs, e.g. from a site it
// replaced). Old paths 301 to the new ones (src/pages/[...path].ts locally, public/_redirects, which the
// Worker's static assets follow); imported content is rewritten.
import { MOVED_PATHS } from './site';

export const PATH_MOVES = MOVED_PATHS;

/** Rewrite old path prefixes in any text, including JSON-escaped ("\/old\/...") forms. */
export function movePaths(text: string): string {
  let out = text;
  for (const [from, to] of PATH_MOVES) {
    out = out.split(from).join(to);
    out = out.split(from.replace(/\//g, '\\/')).join(to.replace(/\//g, '\\/'));
  }
  return out;
}

/** New location for a request path that used an old prefix, or null. */
export function movedPath(pathname: string): string | null {
  for (const [from, to] of PATH_MOVES) {
    if (pathname.startsWith(from) || pathname === from.replace(/\/$/, '')) return to + pathname.slice(from.length);
  }
  return null;
}
