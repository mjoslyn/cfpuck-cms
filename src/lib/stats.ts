// Site statistics: page views, visitors a day, links clicked and the sites visits came from. Pages are
// cached for everyone, so public/assets/js/stats.js reports them from the browser (POST /api/stats); the
// server counts them by day in the site's time zone (table site_stats). No cookies are set and no
// addresses are kept: a visitor is counted once a day by a hash of the day, a secret, their address and
// their browser (site_stat_visitors, emptied after the day), so nobody can be followed across days.
// Machines (scannerAgent) and signed-in editors aren't counted.
import type { Db } from './db/query';
import { env } from './env';
import { SITE_TZ } from './site';
import { scannerAgent } from './mailing/clicks';
import { clientIp } from './mailing/request';

/** How long daily counts are kept. */
export const STATS_KEEP_DAYS = 400;
/** The ranges the Stats screen offers, in days. */
export const STATS_RANGES = [7, 30, 90, 365] as const;

/** The day (YYYY-MM-DD) a moment falls on in the site's time zone. */
export const statsDay = (at: Date = new Date(), tz: string = SITE_TZ) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

/** The day `n` days before `day` (YYYY-MM-DD, calendar days). */
export function daysBefore(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// Addresses that aren't the site's pages: the admin, endpoints, files, tracked email links.
const NOT_PAGES = /^\/(admin|api|media|assets|m\/c|cdn-cgi|_astro)(\/|$)/;

/** A page's address as counted (its path, without query or fragment), or '' if it isn't one. */
export function statPath(p: unknown): string {
  if (typeof p !== 'string' || !p.startsWith('/') || p.startsWith('//')) return '';
  const path = p.split(/[?#]/)[0];
  if (path.length > 300 || NOT_PAGES.test(path) || /[\s<>"]/.test(path)) return '';
  return path;
}

/**
 * Where a clicked link led, as counted: a page of the site as its path; another site as its host and
 * path; an email address or phone number as written. Queries and fragments are left out (they can carry
 * a visitor's details). '' for anything else.
 */
export function statTarget(href: unknown, origin: string): string {
  if (typeof href !== 'string' || !href.trim()) return '';
  let u: URL;
  try {
    u = new URL(href.trim(), origin);
  } catch {
    return '';
  }
  if (u.protocol === 'mailto:' || u.protocol === 'tel:') return `${u.protocol}${u.pathname}`.slice(0, 500);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  if (u.origin === new URL(origin).origin) return statPath(u.pathname) || (u.pathname.startsWith('/media/') ? u.pathname.slice(0, 300) : '');
  return `${u.host}${u.pathname === '/' ? '' : u.pathname}`.slice(0, 500);
}

/** The host of another site a visit came from, or '' (none, this site, or not a web address). */
export function referrerHost(ref: unknown, origin: string): string {
  if (typeof ref !== 'string' || !ref) return '';
  try {
    const u = new URL(ref);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (u.host === new URL(origin).host) return '';
    return u.host.replace(/^www\./, '').slice(0, 200);
  } catch {
    return '';
  }
}

/** The visitor's hash for the day: the same all day, unrelated from one day to the next. */
export async function visitorHash(day: string, ip: string, ua: string): Promise<string> {
  const bytes = new TextEncoder().encode(`site-stats|${env('AUTH_SECRET') ?? ''}|${day}|${ip}|${ua}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface Hit {
  /** `view` (a page shown) or `click` (a link followed). */
  t: 'view' | 'click';
  /** The page's path. */
  p: string;
  /** A view's referrer (document.referrer). */
  r?: string;
  /** A click's link (its href). */
  h?: string;
}

/** Counts one hit the browser reported; false when it isn't counted (not a page, a machine, bad data). */
export async function recordHit(db: Db, body: unknown, request: Request, at: Date = new Date()): Promise<boolean> {
  const hit = (body ?? {}) as Partial<Hit>;
  const origin = new URL(request.url).origin;
  const path = statPath(hit.p);
  if (!path || scannerAgent(request.headers.get('user-agent') ?? '')) return false;
  const day = statsDay(at);
  if (hit.t === 'click') {
    const target = statTarget(hit.h, origin);
    if (!target) return false;
    await db.rpc('stat_hit', { kind: 'click', day, path, target });
    return true;
  }
  if (hit.t !== 'view') return false;
  const visitor = await visitorHash(day, clientIp(request), request.headers.get('user-agent') ?? '');
  await db.rpc('stat_hit', { kind: 'view', day, path, visitor, referrer: referrerHost(hit.r, origin) });
  return true;
}

/** Drops visitor hashes from before today and counts older than STATS_KEEP_DAYS (the hourly run). */
export async function pruneStats(db: Db, at: Date = new Date()): Promise<string> {
  const today = statsDay(at);
  const { count: visitors } = await db.from('site_stat_visitors').delete({ count: 'exact' }).lt('day', today);
  const { count: days } = await db.from('site_stats').delete({ count: 'exact' }).lt('day', daysBefore(today, STATS_KEEP_DAYS));
  return `${visitors ?? 0} visitor hashes and ${days ?? 0} old counts pruned`;
}

export interface StatsSummary {
  from: string;
  to: string;
  totals: { views: number; visitors: number; clicks: number };
  /** Every day of the range, oldest first. */
  daily: { day: string; views: number; visitors: number; clicks: number }[];
  pages: { path: string; views: number }[];
  links: { target: string; clicks: number; pages: number }[];
  referrers: { host: string; visits: number }[];
}

/** The Stats screen's numbers for the `days` days up to today (the editors' `stats_summary`). */
export async function statsSummary(db: Db, days: number, at: Date = new Date()): Promise<StatsSummary> {
  const to = statsDay(at);
  const from = daysBefore(to, days - 1);
  const { data, error } = await db.rpc('stats_summary', { from, to });
  if (error) throw new Error(error.message);
  const r = data as Omit<StatsSummary, 'from' | 'to' | 'totals' | 'daily'> & { daily: { day: string; kind: string; hits: number }[] };
  const byDay = new Map<string, { day: string; views: number; visitors: number; clicks: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const day = daysBefore(to, i);
    byDay.set(day, { day, views: 0, visitors: 0, clicks: 0 });
  }
  const key = { view: 'views', visitor: 'visitors', click: 'clicks' } as const;
  for (const row of r.daily) {
    const d = byDay.get(row.day);
    const k = key[row.kind as keyof typeof key];
    if (d && k) d[k] += Number(row.hits);
  }
  const daily = [...byDay.values()];
  const sum = (k: 'views' | 'visitors' | 'clicks') => daily.reduce((n, d) => n + d[k], 0);
  return { from, to, totals: { views: sum('views'), visitors: sum('visitors'), clicks: sum('clicks') }, daily, pages: r.pages, links: r.links, referrers: r.referrers };
}
