// Admin routes require a Supabase session whose profile role is editor or admin. Site settings and
// users are for admins only.
import { defineMiddleware } from 'astro:middleware';
import { serverClient } from './lib/supabase';
import { refreshSiteTimezone } from './lib/site/timezone';
import { changesPages, PAGE_CACHE_TAG } from './lib/cache';

const PUBLIC_ADMIN = ['/admin/login/', '/admin/set-password/', '/api/auth/login', '/api/auth/logout'];
const ADMIN_ONLY = ['/admin/settings', '/admin/users', '/admin/members', '/api/admin/redirects', '/api/admin/settings', '/api/admin/sync', '/api/admin/users', '/api/admin/members'];

export const onRequest = defineMiddleware(async (context, next) => {
  await refreshSiteTimezone();
  const { pathname } = context.url;
  const isAdmin = pathname.startsWith('/admin') || pathname.startsWith('/api/admin');
  if (!isAdmin || PUBLIC_ADMIN.some((p) => pathname.startsWith(p))) return next();

  const db = serverClient(context.request, context.cookies);
  const { data: { user } } = await db.auth.getUser();
  if (!user) {
    if (pathname.startsWith('/api/')) return new Response('Unauthorized', { status: 401 });
    return context.redirect(`/admin/login/?next=${encodeURIComponent(pathname)}`);
  }
  const { data: profile } = await db.from('profiles').select('role, display_name').eq('id', user.id).maybeSingle();
  if (!profile || !['editor', 'admin'].includes(profile.role)) {
    if (pathname.startsWith('/api/')) return new Response('Forbidden', { status: 403 });
    return context.redirect('/admin/login/?error=forbidden');
  }
  if (profile.role !== 'admin' && ADMIN_ONLY.some((p) => pathname.startsWith(p))) {
    if (pathname.startsWith('/api/')) return new Response('Admins only', { status: 403 });
    return context.redirect('/admin/?error=admins-only');
  }
  context.locals.db = db;
  context.locals.user = { id: user.id, email: user.email ?? '', role: profile.role, name: profile.display_name ?? '' };
  // An edit clears the CDN's cached pages once it succeeds (src/lib/cache.ts), so it shows at once.
  const { method } = context.request;
  const syncAction = pathname.startsWith('/api/admin/sync') && method === 'POST' ? (await context.request.clone().json().catch(() => ({})))?.action : undefined;
  const response = await next();
  if ((response.ok || response.status === 303) && changesPages(method, pathname, syncAction) && context.cache.enabled) {
    // 303: form posts (bulk actions, terms) answer with a redirect back to the list.
    // A failed purge is logged, not the edit's failure: the pages refresh within the minute anyway.
    await context.cache.invalidate({ tags: [PAGE_CACHE_TAG] }).catch((e: Error) => console.error(`page cache purge failed: ${e.message}`));
  }
  return response;
});
