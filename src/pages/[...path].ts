import type { APIRoute } from 'astro';
import type { AstroCookies } from 'astro';
import { renderRequest, type PageResult } from '../render/page';
import { confirmAddress, redirectWith, sessionUser } from '../lib/auth';
import { safeNext } from '../lib/members/account';
import { viewerOf } from '../lib/members/viewer';
import { ACCOUNT_PATH, type Viewer } from '../lib/members/config';
import { eventsOnIn } from '../lib/events/on';
import { handleFormPost } from '../lib/forms/submit';
import { RETURN_PARAM, paymentReturn } from '../lib/forms/checkout';
import { serviceClient, siteDb } from '../lib/supabase';
import { eventsFeed, eventFile } from '../lib/events/ical';
import { SITE_RENDER } from '../lib/site/render';
import { Loader, PUBLIC_SCOPE } from '../lib/data';
import { movedPath } from '../lib/paths';
import { ignoredNotFound, normalizePath } from '../lib/redirects';
import { BROWSER_CACHE_CONTROL, PAGE_CACHE } from '../lib/cache';

/**
 * The page, rendered again as the signed-in visitor sees it when it depends on who views it (members-only
 * content, member prices, the account page). Anyone else gets the first render. Either way it isn't cached.
 */
async function asViewer(first: PageResult, request: Request, cookies: AstroCookies, render: (viewer: Viewer) => Promise<PageResult>): Promise<PageResult> {
  if (!first.personal) return first;
  const viewer = await viewerOf(request, cookies);
  return viewer ? { ...(await render(viewer)), personal: true } : first;
}

export const GET: APIRoute = async ({ url, request, cache, cookies }) => {
  // Path prefixes the site moved (src/site/moved-paths.json).
  const moved = movedPath(url.pathname);
  if (moved) return Response.redirect(new URL(`${moved}${url.search}`, url), 301);
  // Calendar feeds: all events, or one event (or occurrence).
  // Events off (Settings > Events): no feeds.
  if ((url.pathname === '/events.ics' || /\/event\.ics$/.test(url.pathname)) && !(await eventsOnIn(siteDb()))) return new Response('Not found', { status: 404 });
  if (url.pathname === '/events.ics') {
    // Cached like pages: calendar apps poll feeds, and each build loads every event.
    if (cache.enabled) cache.set(PAGE_CACHE);
    return eventsFeed(new Loader(siteDb(), undefined, PUBLIC_SCOPE), { q: url.searchParams.get('q') ?? '', month: url.searchParams.get('month') ?? '', past: url.searchParams.has('past') }, url.origin);
  }
  const single = url.pathname.match(/^\/event\/([^/]+)\/(?:(\d{4}-\d{2}-\d{2})\/)?event\.ics$/);
  if (single) {
    const loader = new Loader(siteDb(), undefined, PUBLIC_SCOPE);
    const entry = await loader.entry('event', single[1], false);
    const res = entry && (await eventFile(loader, entry.id, single[2], url.origin));
    if (res && cache.enabled) cache.set(PAGE_CACHE);
    return res || new Response('Not found', { status: 404 });
  }
  // Pages end in a slash.
  if (!url.pathname.endsWith('/') && !/\.[a-z0-9]+$/i.test(url.pathname)) {
    return Response.redirect(new URL(`${url.pathname}/${url.search}`, url), 301);
  }
  // The site's old URLs (src/site/render.ts redirect).
  const old = SITE_RENDER.redirect?.(url);
  if (old) return Response.redirect(new URL(old, url), 301);
  // A member's link confirming their address signs them in here and goes on (to `next`, else the account
  // page). A link that has expired or was used is only an error for someone not signed in.
  const confirm = url.searchParams.get('confirm');
  if (url.pathname === ACCOUNT_PATH && confirm) {
    const signedIn = await confirmAddress(confirm, request);
    const next = new URL(safeNext(url.searchParams.get('next')) || ACCOUNT_PATH, url);
    if (!signedIn && !(await sessionUser(request))) next.searchParams.set('error', 'That link has expired or was already used. Sign in to get a new one.');
    return redirectWith(next.toString(), signedIn ?? []);
  }
  // Back from a form's checkout: its confirmation or the form again, for this visitor only (never cached).
  const paid = url.searchParams.get(RETURN_PARAM);
  if (paid) {
    const form = await paymentReturn(serviceClient(), paid);
    if (form?.redirect) return new Response(null, { status: 303, headers: { Location: new URL(form.redirect, url).toString(), 'Cache-Control': 'no-store' } });
    const page = new URL(url);
    page.searchParams.delete(RETURN_PARAM);
    const { status, html } = await renderRequest(page, siteDb(), form ?? undefined);
    return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
  }
  const result = await asViewer(await renderRequest(url, siteDb()), request, cookies, (viewer) => renderRequest(url, siteDb(), undefined, undefined, viewer));
  const { status, html, location } = result;
  // A buyer's own order (?order=<token>), a checkout's outcome (?tickets=) and pages that depend on who
  // views them are never cached.
  const personal = url.searchParams.has('order') || url.searchParams.has('tickets') || !!result.personal;
  // Cached at the CDN and cleared after edits (src/lib/cache.ts).
  if (cache.enabled && !personal) cache.set(location ? { ...PAGE_CACHE, swr: undefined } : PAGE_CACHE);
  if (location) {
    return new Response(null, { status, headers: { Location: new URL(location, url).toString(), 'Cache-Control': BROWSER_CACHE_CONTROL } });
  }
  // Addresses still not found are logged for the redirects screen.
  if (status === 404 && !ignoredNotFound(url.pathname)) await siteDb().rpc('not_found_hit', { hit_path: normalizePath(url.pathname), hit_referrer: request.headers.get('referer') ?? '' }).then(() => {}, () => {});
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': personal ? 'private, no-store' : BROWSER_CACHE_CONTROL,
      ...(personal ? { 'X-Robots-Tag': 'noindex' } : {}),
    },
  });
};

/** Form submissions post back to the page the form is on. */
export const POST: APIRoute = async ({ url, request, cookies }) => {
  // Only form submissions post to pages (anything else, e.g. JSON to a missing endpoint, is not found).
  const type = request.headers.get('content-type') ?? '';
  if (!/multipart\/form-data|application\/x-www-form-urlencoded/i.test(type)) return new Response('Not found', { status: 404 });
  const data = await request.formData();
  const form = await handleFormPost(data, request);
  if (form?.busy) return new Response('This form is receiving too many submissions. Please go back and try again in a minute.', { status: 429, headers: { 'Retry-After': '60' } });
  if (form?.redirect) return Response.redirect(new URL(form.redirect, url), 303);
  const { status, html } = await asViewer(await renderRequest(url, siteDb(), form ?? undefined), request, cookies, (viewer) => renderRequest(url, siteDb(), form ?? undefined, undefined, viewer));
  return new Response(html, { status: form ? 200 : status, headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Cache-Control': 'no-store' } });
};
