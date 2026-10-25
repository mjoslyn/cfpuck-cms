// Admin routes require a session (src/lib/auth) whose profile role is editor or admin. Site settings and
// users are for admins only. locals.db reads and writes as that role (src/lib/db/policies.ts).
import { defineMiddleware } from 'astro:middleware';
import { sessionDb, siteDb } from './lib/db/site';
import { sessionUser } from './lib/auth';
import { refreshSiteTimezone } from './lib/site/timezone';
import { changesPages, PAGE_CACHE_TAG } from './lib/cache';
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
  if (pathname === '/api/admin/db') {
    const body = await request.clone().json().catch(() => ({}));
    return body?.query?.action ?? (body?.call ? 'call' : undefined);
  }
  return undefined;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;
  if (crossSite(context.request, context.url) && !CROSS_SITE_POSTS.includes(pathname)) {
    return new Response(`Cross-site ${context.request.method} form submissions are forbidden`, { status: 403 });
  }
  await refreshSiteTimezone();
  const isAdmin = pathname.startsWith('/admin') || pathname.startsWith('/api/admin');
  if (!isAdmin || PUBLIC_ADMIN.some((p) => pathname.startsWith(p))) return next();

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
  // An edit clears the CDN's cached pages once it succeeds (src/lib/cache.ts), so it shows at once.
  const { method } = context.request;
  const action = await bodyAction(context.request, pathname);
  const response = await next();
  if ((response.ok || response.status === 303) && changesPages(method, pathname, action) && context.cache.enabled) {
    // 303: form posts (bulk actions, terms) answer with a redirect back to the list.
    // A failed purge is logged, not the edit's failure: the pages refresh within the minute anyway.
    await context.cache.invalidate({ tags: [PAGE_CACHE_TAG] }).catch((e: Error) => console.error(`page cache purge failed: ${e.message}`));
  }
  return response;
});
