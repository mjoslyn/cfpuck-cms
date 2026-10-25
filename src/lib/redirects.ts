// Redirects (/admin/redirects/, table redirects): applied to addresses that would otherwise be Not
// found. Rules are exact paths or prefixes ending in "*"; the rest of the path replaces a "*" in the
// target. Addresses still not found are logged (table not_found) so editors can add redirects.
import type { Db } from './db/query';

export interface Redirect {
  id: number;
  from_path: string;
  to_url: string;
  status: 301 | 302;
  note: string;
  hits: number;
  last_hit_at: string | null;
}

/**
 * A path as rules store and match it: from a full URL or a path, without query or fragment, lower
 * case, with a leading slash and (for page addresses) a trailing one. A trailing "*" is kept.
 */
export function normalizePath(input: string): string {
  let p = input.trim();
  try {
    if (/^https?:\/\//i.test(p)) p = new URL(p).pathname;
  } catch {}
  p = p.replace(/[?#].*$/, '');
  try {
    p = decodeURI(p);
  } catch {}
  p = p.toLowerCase();
  if (!p.startsWith('/')) p = `/${p}`;
  const wild = p.endsWith('*');
  if (wild) p = p.slice(0, -1);
  if (!p.endsWith('/') && !/\.[a-z0-9]{1,6}$/.test(p)) p += '/';
  p = p.replace(/\/{2,}/g, '/');
  return wild ? `${p}*` : p;
}

/** A redirect's target, checked: a site path or a web address. */
export function cleanTarget(input: string): string | null {
  const t = input.trim();
  if (/^https?:\/\/[^\s]+$/i.test(t)) return t;
  if (t.startsWith('/') && !t.startsWith('//')) return t;
  return null;
}

/**
 * Whether a rule covers a normalized path: an exact rule its own path only; a wildcard ("/old/*")
 * every path that starts with its prefix ("/old/"). The one place this is decided.
 */
export function ruleCovers(fromPath: string, path: string): boolean {
  return fromPath.endsWith('*') ? path.startsWith(fromPath.slice(0, -1)) : path === fromPath;
}

/** A wildcard rule's target with the rest of the path put in place of its "*". */
export function ruleTarget(rule: Pick<Redirect, 'from_path' | 'to_url'>, path: string): string {
  if (!rule.from_path.endsWith('*') || !rule.to_url.includes('*')) return rule.to_url;
  return rule.to_url.replace('*', path.slice(rule.from_path.length - 1));
}

/** Why a rule would send visitors in circles, or null. */
export function loopReason(fromPath: string, to: string): string | null {
  if (!to.startsWith('/')) return null;
  const target = normalizePath(to.replace(/\*$/, ''));
  if (!fromPath.endsWith('*')) return target === fromPath ? 'The old and new addresses are the same.' : null;
  // A wildcard whose target is under its own prefix redirects to itself, or nests without end.
  return ruleCovers(fromPath, target) ? `The new address is inside ${fromPath}, so the redirect would lead back to itself.` : null;
}

/** The rule for a path, if any: an exact match, else the wildcard with the longest prefix. */
export async function findRedirect(db: Db, pathname: string): Promise<{ rule: Redirect; location: string } | null> {
  const path = normalizePath(pathname);
  const { data: exact } = await db.from('redirects').select('*').eq('from_path', path).maybeSingle();
  if (exact) return { rule: exact as Redirect, location: exact.to_url };
  const { data: wild } = await db.from('redirects').select('*').eq('wildcard', true);
  const match = ((wild ?? []) as Redirect[]).filter((r) => ruleCovers(r.from_path, path)).sort((a, b) => b.from_path.length - a.from_path.length)[0];
  return match ? { rule: match, location: ruleTarget(match, path) } : null;
}

/** Addresses not worth logging: files, admin and API paths, and obvious probes. */
export const ignoredNotFound = (pathname: string) =>
  /^\/(admin|api|_astro|assets|media)\//.test(pathname) || /\.(php|asp|aspx|env|git|sql|bak|zip|js|css|map|png|jpe?g|gif|svg|webp|avif|ico|txt|xml)$/i.test(pathname) || pathname.length > 300;

/**
 * A published entry moved from `before` to `after` (its address changed): the old address redirects
 * to the new one, redirects that led to the old address lead to the new one, and a redirect away from
 * the new address (it moved back) goes.
 */
export async function redirectMovedEntry(db: Db, before: string, after: string): Promise<void> {
  const from = normalizePath(before);
  if (from === normalizePath(after)) return;
  await db.from('redirects').delete().eq('from_path', normalizePath(after));
  await db.from('redirects').update({ to_url: after }).eq('to_url', before);
  await db.from('redirects').upsert({ from_path: from, to_url: after, status: 301, note: 'Address changed' }, { onConflict: 'from_path' });
}
