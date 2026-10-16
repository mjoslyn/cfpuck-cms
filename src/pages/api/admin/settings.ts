import type { APIRoute } from 'astro';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ARCHIVE_PATHS, CONTENT_TYPES, isTimezone, SEARCHABLE_TYPES, SITE_TZ, site as config } from '../../../lib/site';
import { moveEventsToTimezone, refreshSiteTimezone } from '../../../lib/site/timezone';
import { socialLinks } from '../../../lib/social/links';
import { makeSiteIcons } from '../../../lib/media/site-icon';
import { MediaStore } from '../../../lib/media/process';
import { serviceClient } from '../../../lib/supabase';
import { adminThemeFrom, loadAdminTheme, type AdminTheme } from '../../../lib/admin-theme';
import { downsize, mediaUrl, versioned } from '../../../lib/media/image';
import type { Media } from '../../../lib/types';
import { ticketSettingsFrom } from '../../../lib/tickets/config';
import { memberSettingsFrom } from '../../../lib/members/config';
import { mailingSettingsFrom } from '../../../lib/mailing/config';

/** Templates chosen per type ({ [type]: { single, archive } }): known types, template-like slugs. */
function templatesFrom(v: unknown): Record<string, { single?: string; archive?: string }> | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const slug = (s: unknown) => (typeof s === 'string' && /^[a-z0-9][a-z0-9_/-]*$/.test(s) ? s : undefined);
  const out: Record<string, { single?: string; archive?: string }> = {};
  for (const t of CONTENT_TYPES) {
    const m = (v as Record<string, any>)[t.type];
    const single = slug(m?.single);
    const archive = slug(m?.archive);
    if (single || archive) out[t.type] = { ...(single ? { single } : {}), ...(archive ? { archive } : {}) };
  }
  return Object.keys(out).length ? out : undefined;
}

/** A template chosen per taxonomy's term pages ({ [taxonomy]: slug }): known taxonomies, template-like slugs. */
function taxonomyTemplatesFrom(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const t of config.taxonomies) {
    const slug = (v as Record<string, unknown>)[t.name];
    if (typeof slug === 'string' && /^[a-z0-9][a-z0-9_/-]*$/.test(slug)) out[t.name] = slug;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Featured image and SEO by name (known names, known keys): a taxonomy's defaults for its term pages,
 *  or a type's listing page. */
function pageMetaFrom(v: unknown, names: string[]): Record<string, unknown> | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const text = (x: unknown, max: number) => (typeof x === 'string' ? x.slice(0, max) : '');
  const out: Record<string, unknown> = {};
  for (const name of names) {
    const m = (v as Record<string, any>)[name];
    if (!m || typeof m !== 'object') continue;
    const image = Number(m.image) > 0 ? Number(m.image) : undefined;
    const seo = Object.fromEntries(Object.entries({ title: text(m.seo?.title, 300), description: text(m.seo?.description, 1000), noindex: m.seo?.noindex === true || undefined }).filter(([, x]) => x));
    const entry = { ...(image ? { image, image_url: text(m.image_url, 2000) } : {}), ...(Object.keys(seo).length ? { seo } : {}) };
    if (Object.keys(entry).length) out[name] = entry;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Taxonomies whose term pages are turned off (those with pages), or undefined for none. */
function taxonomyPagesOffFrom(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const off = config.taxonomies.filter((t) => t.base && v.includes(t.name)).map((t) => t.name);
  return off.length ? off : undefined;
}

/** Types whose listing page is turned off (types with one only), or undefined for none. */
function listingsOffFrom(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const off = Object.keys(ARCHIVE_PATHS).filter((t) => v.includes(t));
  return off.length ? off : undefined;
}

/** The searchable types chosen (known ones only), or undefined for all. */
function searchTypesFrom(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const picked = SEARCHABLE_TYPES.filter((t) => v.includes(t));
  return picked.length === SEARCHABLE_TYPES.length ? undefined : picked;
}

/** The admin theme posted, its logo's URL made here from the media row (a size fit for the menu bar). */
async function adminThemeWithLogo(db: SupabaseClient, v: unknown): Promise<AdminTheme | undefined> {
  const id = Number((v as AdminTheme | undefined)?.logo) || 0;
  let logo_url: string | undefined;
  if (id > 0) {
    const { data: m } = await db.from('media').select('*').eq('id', id).maybeSingle<Media>();
    if (m) logo_url = versioned(m, mediaUrl(downsize(m, 'medium_large').path));
  }
  return adminThemeFrom({ ...(v as object), logo_url });
}

/** Update the site identity, timezone and the site's own options. Only known keys are writable. */
export const PUT: APIRoute = async ({ request, locals }) => {
  const body = await request.json();
  const { data: current } = await locals.db.from('settings').select('value').eq('key', 'site').single();
  const timezone = body.site?.timezone || undefined;
  if (timezone && !isTimezone(timezone)) return new Response(`Unknown timezone: ${timezone}`, { status: 400 });
  const before = current?.value?.timezone || config.timezone;
  const site = { ...(current?.value ?? {}), name: body.site?.name, description: body.site?.description, front_page_id: body.site?.front_page_id ?? null, timezone, search_types: searchTypesFrom(body.site?.search_types), templates: templatesFrom(body.site?.templates), taxonomy_templates: taxonomyTemplatesFrom(body.site?.taxonomy_templates), taxonomy_pages_off: taxonomyPagesOffFrom(body.site?.taxonomy_pages_off), taxonomy_meta: pageMetaFrom(body.site?.taxonomy_meta, config.taxonomies.map((t) => t.name)), listing_meta: pageMetaFrom(body.site?.listing_meta, Object.keys(ARCHIVE_PATHS)), listings_off: listingsOffFrom(body.site?.listings_off), social: socialLinks(body.site), share_image: Number(body.site?.share_image) || undefined, share_image_url: body.site?.share_image ? String(body.site?.share_image_url ?? '') : undefined, admin_theme: await adminThemeWithLogo(locals.db, body.site?.admin_theme), tickets: ticketSettingsFrom(body.site?.tickets), members: memberSettingsFrom(body.site?.members), mailing: mailingSettingsFrom(body.site?.mailing), events: body.site && 'events' in body.site ? (body.site.events?.enabled === true ? { enabled: true } : undefined) : current?.value?.events };
  const rows = [{ key: 'site', value: site }, ...(body.options ? [{ key: 'options', value: body.options }] : [])];
  // The site icon: a newly chosen image is made into the icon files; removing it removes them.
  if (body.site && 'icon_media_id' in body.site) {
    const iconId = Number(body.site.icon_media_id) || null;
    if (!iconId) {
      for (const k of ['icon_media_id', 'icons', 'icon_192']) delete (site as Record<string, unknown>)[k];
    } else if (iconId !== current?.value?.icon_media_id) {
      try {
        const icons = await makeSiteIcons(locals.db, new MediaStore(serviceClient()), iconId);
        Object.assign(site, { icon_media_id: iconId, icons, icon_192: icons['192'] });
      } catch (e) {
        return new Response(`Could not make the site icon: ${(e as Error).message}`, { status: 400 });
      }
    }
  }
  const { error } = await locals.db.from('settings').upsert(rows, { onConflict: 'key' });
  if (error) return new Response(error.message, { status: 400 });
  const after = timezone || config.timezone;
  const moved = after !== before ? await moveEventsToTimezone(locals.db, before, after) : 0;
  await refreshSiteTimezone(locals.db, true);
  await loadAdminTheme(locals.db, true);
  return Response.json({ ok: true, timezone: SITE_TZ, moved });
};
