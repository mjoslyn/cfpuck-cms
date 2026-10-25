// The CDN's copies of the site's pages, through Astro's route cache (the `cache` provider in
// astro.config.mjs, Cloudflare's: the Workers cache, tagged, purged by tag). Pages are fresh for a minute, then
// served stale for up to a week while they refresh in the background; every successful admin edit
// clears them (the middleware), so it shows on the next visit. Under astro dev nothing is cached.

/** The cache tag on every page (and the search API), so a purge leaves files like /media/ cached. */
export const PAGE_CACHE_TAG = 'pages';

/** Route cache options for a public page. */
export const PAGE_CACHE = { maxAge: 60, swr: 604800, tags: [PAGE_CACHE_TAG] };

/** Browsers always revalidate a page (the CDN holds the copy). */
export const BROWSER_CACHE_CONTROL = 'public, max-age=0, must-revalidate';

// Admin endpoints whose writes don't change a public page: previews (an email's events too), Claude drafting text for review,
// accessibility marks, form submissions, users and the attendee list (tickets a cancellation frees
// show within the minute, and the ticket form checks what's left as it loads). Everything else under
// /api/admin that succeeds with POST, PUT, PATCH or DELETE clears the pages.
// Mailing's campaigns, digests and contacts aren't on pages (its lists are: Subscribe blocks name them).
const NO_PURGE = ['/api/admin/mailing/campaigns', '/api/admin/mailing/contacts', '/api/admin/mailing/digests', '/api/admin/mailing/preview', '/api/admin/mailing/segments', '/api/admin/a11y', '/api/admin/compose', '/api/admin/email-events', '/api/admin/excerpt', '/api/admin/meta-compose', '/api/admin/seo', '/api/admin/submissions', '/api/admin/tickets', '/api/admin/users'];
// Settings > Sync: only syncing into this copy and restoring a backup here change its content.
const SYNC_WRITES = ['apply', 'restoreBackup'];

/**
 * Whether an admin request changes what the public pages show. `action`: a sync request's action, or
 * for the admin's queries from the browser (/api/admin/db) the query's (`select` reads; a call reads).
 */
export function changesPages(method: string, pathname: string, action?: string): boolean {
  if (!pathname.startsWith('/api/admin/') || ['GET', 'HEAD', 'OPTIONS'].includes(method)) return false;
  if (pathname.endsWith('/notification-preview') || NO_PURGE.some((p) => pathname.startsWith(p))) return false;
  if (pathname.startsWith('/api/admin/sync')) return SYNC_WRITES.includes(action ?? '');
  if (pathname === '/api/admin/db') return !!action && action !== 'select' && action !== 'call';
  return true;
}
