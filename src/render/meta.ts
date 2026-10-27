// <head> tags for search engines and social cards: description, canonical URL, robots, Open Graph
// and Twitter card tags, and on the home page Organization data with the site's social profiles.
// Entries use their SEO settings (fields.seo) and fall back to their excerpt and featured image, then
// to the site's tagline and default share image (Settings). Term pages use the term's SEO, then its
// taxonomy's; type listing pages their own (src/lib/page-meta.ts).
import type { RenderCtx } from './env';
import { esc } from './html';
import { permalink } from '../lib/permalink';
import { downsize, mediaUrl } from '../lib/media/image';
import { seoOf, summary } from '../lib/seo';
import { socialLinks } from '../lib/social/links';
import { site as config } from '../lib/site';
import { listingSeo, termSeo } from '../lib/page-meta';
import { ARCHIVE_PATHS } from '../lib/site';

const attr = (s: string) => esc(s).replace(/"/g, '&quot;');

/** `docTitle` is the page's <title>; social cards show the page's own title without the site name. */
export async function headMeta(ctx: RenderCtx, docTitle: string): Promise<string> {
  const { queried, loader, settings } = ctx;
  const origin = queried.url.origin;
  const siteSettings = settings.site ?? {};
  const entry = queried.kind === 'singular' ? queried.entry : undefined;
  const term = queried.kind === 'taxonomy' ? queried.term : undefined;
  const listing = queried.kind === 'archive' && queried.postType ? queried.postType : undefined;
  const seo = term ? termSeo(term, siteSettings) : listing ? listingSeo(siteSettings, listing, ARCHIVE_PATHS[listing] === queried.url.pathname && !queried.url.searchParams.get('q')) : seoOf(entry?.fields);
  const description = seo.description || (entry ? summary(entry.excerpt_rendered ?? entry.excerpt) : '') || (queried.isFront || !entry ? summary(siteSettings.description) : '');
  const path = queried.notFound ? queried.url.pathname : entry ? (queried.isFront ? '/' : permalink(entry)) : queried.kind === 'search' ? '/search/' : queried.url.pathname;
  const url = origin + path;

  const imageId = [seo.image, entry?.featured_media_id, siteSettings.share_image].map(Number).find((n) => n > 0);
  if (imageId) await loader.loadMedia([imageId]);
  const media = imageId ? loader.mediaById(imageId) : undefined;
  const image = media ? downsize(media, 'large') : undefined;

  const tags: string[] = [];
  if (description) tags.push(`<meta name="description" content="${attr(description)}" />`);
  // noindex keeps out search engines and, with noai, the AI tools that read the tag (robots.txt asks the rest).
  // The Not found page stays out too, at a missing address and at its own.
  const notFoundPage = queried.notFound || (!!entry && entry.id === Number(siteSettings.not_found_page_id));
  if (seo.noindex || notFoundPage) tags.push('<meta name="robots" content="noindex, follow, noai, noimageai" />');
  if (queried.kind !== 'search' && queried.kind !== '404' && !queried.notFound) tags.push(`<link rel="canonical" href="${attr(url)}" />`);
  tags.push(
    `<meta property="og:site_name" content="${attr(siteSettings.name ?? config.name)}" />`,
    `<meta property="og:type" content="${entry && entry.type !== 'page' ? 'article' : 'website'}" />`,
    `<meta property="og:title" content="${attr(seo.title || (queried.isFront ? (siteSettings.name ?? config.name) : entry ? summary(entry.title_rendered ?? entry.title, 200) : summary(docTitle.replace(/ &#8211; [^&]*$/, ''), 200)))}" />`,
    `<meta property="og:url" content="${attr(url)}" />`,
  );
  if (description) tags.push(`<meta property="og:description" content="${attr(description)}" />`);
  if (image && media) {
    tags.push(`<meta property="og:image" content="${attr(origin + mediaUrl(image.path))}" />`);
    if (image.width && image.height) tags.push(`<meta property="og:image:width" content="${image.width}" />`, `<meta property="og:image:height" content="${image.height}" />`);
    if (media.alt) tags.push(`<meta property="og:image:alt" content="${attr(media.alt)}" />`);
  }
  tags.push(`<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`);

  if (queried.isFront) {
    const sameAs = socialLinks(siteSettings).filter((l) => /^https?:/i.test(l.url)).map((l) => l.url);
    const org = { '@context': 'https://schema.org', '@type': 'Organization', name: config.organization, url: `${origin}/`, ...(sameAs.length ? { sameAs } : {}) };
    tags.push(`<script type="application/ld+json">${JSON.stringify(org).replace(/</g, '\\u003c')}</script>`);
  }
  return tags.map((t) => `\t${t}\n`).join('');
}
