// search_site: Claude looks up the site's own content (every listable type, and pages) to feature or
// link to it. Featured images (or logos, for types with a logoField) join the conversation's
// materials so the page can use them.
import type { Db } from '../db/query';
import { Loader } from '../data';
import { permalink } from '../permalink';
import { formatDate } from '../date-format';
import type { Entry, Media } from '../types';
import { registerImage, type Registry } from './materials';
import { LISTABLE_TYPES, SITE_TZ, typeDef } from '../site';

export const SEARCH_SCHEMA = {
  type: 'object',
  properties: {
    types: { type: 'array', items: { type: 'string', enum: [...LISTABLE_TYPES, 'page'] }, description: 'Content types to search (default: all).' },
    query: { type: 'string', description: 'Words that must appear in the title, excerpt or text (optional).' },
    tag: { type: 'string', description: 'Only entries with this tag (optional).' },
    upcoming: { type: 'boolean', description: 'Events: only upcoming ones, soonest first.' },
    limit: { type: 'integer', minimum: 1, maximum: 20, description: 'How many results (default 10).' },
  },
} as const;

const plain = (s: unknown) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;/g, '’').replace(/&[#\w]+;/g, ' ').replace(/\s+/g, ' ').trim();
const ALL = [...LISTABLE_TYPES, 'page'];
const byTitle = (types: string[]) => types.every((t) => typeDef(t)?.order === 'title');
const logoOf = (e: Entry) => {
  const field = typeDef(e.type)?.logoField;
  return field ? Number(e.fields?.[field]) || null : null;
};

export async function searchSite(db: Db, reg: Registry, input: Record<string, any>): Promise<{ results: unknown[]; summary: string }> {
  const loader = new Loader(db);
  const types = Array.isArray(input.types) && input.types.length ? input.types.filter((t: string) => ALL.includes(t)) : ALL;
  const terms: Record<string, number[]> = {};
  if (input.tag) {
    const tag = (await loader.allTerms()).find((t) => t.taxonomy === 'tag' && t.name.toLowerCase() === String(input.tag).toLowerCase());
    if (!tag) return { results: [], summary: `No tag called "${input.tag}".` };
    terms.tag = [tag.id];
  }
  const limit = Math.min(20, Math.max(1, Number(input.limit) || 10));
  const upcoming = !!input.upcoming && types.length === 1 && types[0] === 'event';
  const result = await loader.query({ postType: types, perPage: limit, search: input.query || undefined, terms, upcoming, orderBy: byTitle(types) ? 'title' : 'date', order: byTitle(types) ? 'asc' : 'desc' });
  const entries = result.ids.map((id) => loader.entries.get(id)!).filter(Boolean) as Entry[];

  // Images: the entry's logo (types with a logoField), or its featured image.
  const mediaIds = entries.flatMap((e) => [e.featured_media_id, logoOf(e)].filter(Boolean) as number[]);
  await loader.loadMedia(mediaIds);
  const image = (e: Entry) => {
    const logo = logoOf(e);
    const m = (logo && loader.media.get(logo)) || (e.featured_media_id ? loader.media.get(e.featured_media_id) : undefined);
    return m ? registerImage(reg, m as Media) : undefined;
  };

  const results = entries.map((e) => {
    const f = e.fields ?? {};
    const out: Record<string, unknown> = { id: e.id, type: e.type, title: plain(e.title), url: permalink(e) };
    const excerpt = plain(e.excerpt).slice(0, 240);
    if (excerpt) out.excerpt = excerpt;
    if (e.type === 'event' && e.event_start) {
      const tz = f.timezone || SITE_TZ;
      const start = formatDate('D, M j, Y', e.event_start, tz);
      const end = e.event_end ? formatDate('D, M j, Y', e.event_end, tz) : start;
      out.when = start === end ? start : `${start} – ${end}`;
    }
    for (const k of ['address', 'phone', 'email', 'website', 'hours', 'link', 'cost']) if (f[k] && typeof f[k] !== 'object') out[k] = plain(f[k]).slice(0, 200);
    const img = image(e);
    if (img) out.image = img;
    return out;
  });
  return { results, summary: `${results.length} of ${result.total} ${types.length === 1 ? `${types[0]}s` : 'entries'}` };
}
