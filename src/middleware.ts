// Admin routes require a session (src/lib/auth) whose profile role is editor or admin. Site settings and
// users are for admins only. locals.db reads and writes as that role (src/lib/db/policies.ts).
import { defineMiddleware } from 'astro:middleware';
import { sessionDb, siteDb } from './lib/db/site';
import { sessionUser } from './lib/auth';
import { refreshSiteTimezone } from './lib/site/timezone';
import { changesPages, PAGE_CACHE_TAG } from './lib/cache';
import { env } from './lib/env';
// Server-only work the page renderer calls (src/render/hooks.ts).
import './lib/mailing/page-data';

const PUBLIC_ADMIN = ['/admin/login/', '/admin/set-password/', '/api/auth/login', '/api/auth/logout'];
const ADMIN_ONLY = ['/admin/settings', '/admin/users', '/admin/members', '/api/admin/redirects', '/api/admin/settings', '/api/admin/sync', '/api/admin/users', '/api/admin/members', '/api/admin/mailing/contacts', '/api/admin/mailing/lists'];

// Astro's own same-site check (security.checkOrigin) is off in astro.config.mjs and done here instead, the
// same way, so that these routes can be posted to from elsewhere: mail apps' one-click unsubscribe
// (RFC 8058) comes from the mail provider's servers.
const CROSS_SITE_POSTS = ['/api/mail/unsubscribe'];
const FORM_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];

/** A non-GET request from another site: refused when it is form-like (or has no content type at all). */
function crossSite(request: Request, url: URL): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method) || request.headers.get('origin') === url.origin) return false;
  const type = request.headers.get('content-type');
  return type === null || FORM_TYPES.some((t) => type.toLowerCase().includes(t));
}

/** What a sync request or an admin query from the browser does, for changesPages. */
async function bodyAction(request: Request, pathname: string): Promise<string | undefined> {
  if (request.method !== 'POST') return undefined;
  if (pathname.startsWith('/api/admin/sync')) return (await request.clone().json().catch(() => ({})))?.action;
  if (pathname === '/api/admin/db' || pathname === '/api/sync/remote') {
    const body = await request.clone().json().catch(() => ({}));
    return body?.query?.action ?? (body?.call ? 'call' : undefined);
  }
  return undefined;
}

/** Marks an answer noindex for search engines. */
async function noindex(res: Response | Promise<Response>) {
  const r = await res;
  if (r.headers.has('X-Robots-Tag')) return r;
  try {
    r.headers.set('X-Robots-Tag', 'noindex');
    return r;
  } catch {
    // A response with fixed headers (Response.redirect, a fetched one): a copy whose headers can change.
    const copy = new Response(r.body, r);
    copy.headers.set('X-Robots-Tag', 'noindex');
    return copy;
  }
}

let noindexAllValue: boolean | undefined;
/** Whether the whole site is kept out of search engines (SITE_NOINDEX=1 or true: a demo or preview copy).
 * Read once in the Worker, whose variables don't change while it runs; under astro dev on each request. */
function noindexAll(): boolean {
  if (noindexAllValue !== undefined) return noindexAllValue;
  const value = /^(1|true)$/i.test(env('SITE_NOINDEX')?.trim() ?? '');
  if (!import.meta.env.DEV) noindexAllValue = value;
  return value;
}

/** Whether the request came to another address than the site's own (SITE_URL): a workers.dev or preview
 * copy, which search engines are kept out of. Without SITE_URL every address counts as the site's. */
function offSite(url: URL): boolean {
  const own = env('SITE_URL');
  if (!own) return false;
  try {
    return new URL(own).host !== url.host;
  } catch {
    return false;
  }
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  if (crossSite(context.request, context.url) && !CROSS_SITE_POSTS.includes(pathname)) {
    return new Response(`Cross-site ${context.request.method} form submissions are forbidden`, { status: 403 });
  }
  await refreshSiteTimezone();
  // The other copy's queries during a sync (signed; the route checks them) clear the pages as edits do.
  if (pathname === '/api/sync/remote') return purgeAfter(context, next);
  const isAdmin = pathname.startsWith('/admin') || pathname.startsWith('/api/admin');
  // The admin is never indexed, nor is any page at an address other than the site's, nor any at all
  // while SITE_NOINDEX is set.
  if (!isAdmin) return noindexAll() || offSite(context.url) ? noindex(next()) : next();
  if (PUBLIC_ADMIN.some((p) => pathname.startsWith(p))) return noindex(next());

  const user = await sessionUser(context.request);
  if (!user) {
    if (pathname.startsWith('/api/')) return new Response('Unauthorized', { status: 401 });
    return context.redirect(`/admin/login/?next=${encodeURIComponent(pathname)}`);
  }
  const { data: profile } = await siteDb().from('profiles').select('role, display_name').eq('id', user.id).maybeSingle();
  if (!profile || !['editor', 'admin'].includes(profile.role)) {
    if (pathname.startsWith('/api/')) return new Response('Forbidden', { status: 403 });
    return context.redirect('/admin/login/?error=forbidden');
  }
  if (profile.role !== 'admin' && ADMIN_ONLY.some((p) => pathname.startsWith(p))) {
    if (pathname.startsWith('/api/')) return new Response('Admins only', { status: 403 });
    return context.redirect('/admin/?error=admins-only');
  }
  context.locals.db = sessionDb({ role: profile.role, uid: user.id });
  context.locals.user = { id: user.id, email: user.email ?? '', role: profile.role, name: profile.display_name ?? '' };
  return purgeAfter(context, () => noindex(next()));
});

/** Answers the request, then clears the CDN's cached pages if it was an edit that succeeded (src/lib/cache.ts), so it shows at once. */
async function purgeAfter(context: Parameters<Parameters<typeof defineMiddleware>[0]>[0], answer: () => Promise<Response>): Promise<Response> {
  const { method } = context.request;
  const { pathname } = context.url;
  const action = await bodyAction(context.request, pathname);
  const response = await answer();
  if ((response.ok || response.status === 303) && changesPages(method, pathname, action) && context.cache.enabled) {
    // 303: form posts (bulk actions, terms) answer with a redirect back to the list.
    // A failed purge is logged, not the edit's failure: the pages refresh within the minute anyway.
    await context.cache.invalidate({ tags: [PAGE_CACHE_TAG] }).catch((e: Error) => console.error(`page cache purge failed: ${e.message}`));
  }
  return response;
}
