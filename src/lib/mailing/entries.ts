// Entries for the email builder's Entries block (mailing emails; src/lib/forms/email.ts renders it like
// the Events block): the latest published entries of some types, optionally of some terms, and in a
// digest only those published since its last issue. Members-only entries are left out: an email can go
// to anyone. Loaded before an email is rendered, by block id. Server only.
import type { SupabaseClient } from '@supabase/supabase-js';
import { Loader, PUBLIC_SCOPE } from '../data';
import { downsize, mediaUrl } from '../media/image';
import { permalink } from '../permalink';
import { LISTABLE_TYPES, SITE_TZ } from '../site';
import { eventsOnIn } from '../events/on';
import { EVENT_TYPES } from '../events/types';
import type { EmailDoc, EmailEvent, EmailItem } from '../forms/email';

/** What an Entries block lists (its `query` setting). */
export interface EmailEntriesQuery {
  /** Content types (none: posts, else the first listable type). */
  types?: string[];
  count?: number;
  /** Term ids (any of). */
  terms?: number[];
  /** In a digest: only entries published since its last issue (else the latest, whenever published). */
  newOnly?: boolean;
  showDate?: boolean;
}

export const MAX_EMAIL_ENTRIES = 12;

function entryBlocks(items: EmailItem[] = []): EmailItem[] {
  return items.flatMap((it) => [...(it.type === 'Entries' ? [it] : []), ...['content', 'left', 'right'].flatMap((slot) => (Array.isArray(it.props?.[slot]) ? entryBlocks(it.props[slot]) : []))]);
}

const strip = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;/g, '’').replace(/&#8220;|&#8221;/g, '"').replace(/&[a-z0-9#]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const words = (s: string, n: number) => {
  const list = s.split(' ').filter(Boolean);
  return list.length > n ? `${list.slice(0, n).join(' ')}…` : list.join(' ');
};

/** The types an Entries block may list: those with pages and listings, events only while events are on. */
export function entryTypes(q: EmailEntriesQuery, events: boolean): string[] {
  const allowed = LISTABLE_TYPES.filter((t) => events || !EVENT_TYPES.includes(t));
  const picked = (q.types ?? []).filter((t) => allowed.includes(t));
  return picked.length ? picked : allowed.includes('post') ? ['post'] : allowed.slice(0, 1);
}

async function load(db: SupabaseClient, q: EmailEntriesQuery, origin: string, since: string | null, events: boolean): Promise<EmailEvent[]> {
  const loader = new Loader(db, undefined, { ...PUBLIC_SCOPE, noEvents: !events });
  const count = Math.min(MAX_EMAIL_ENTRIES, Math.max(1, Math.round(Number(q.count) || 3)));
  const terms = (q.terms ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  // The newest first; when only new ones count, a few more are read and those older than the last issue dropped.
  const result = await loader.query({ postType: entryTypes(q, events), perPage: q.newOnly && since ? 50 : count, orderBy: 'date', order: 'desc', ...(terms.length ? { terms: { any: terms } } : {}) });
  let entries = result.ids.map((id) => loader.entries.get(id)!).filter(Boolean);
  if (q.newOnly && since) entries = entries.filter((e) => e.published_at && e.published_at > since);
  entries = entries.slice(0, count);
  await loader.loadMedia(entries.map((e) => e.featured_media_id).filter((n): n is number => !!n));
  const { data } = entries.length ? await db.from('entries').select('id, body_text').in('id', entries.map((e) => e.id)) : { data: [] };
  const text = new Map((data ?? []).map((r) => [r.id, String(r.body_text ?? '')]));
  const base = origin.replace(/\/$/, '');
  const date = new Intl.DateTimeFormat('en-US', { timeZone: SITE_TZ, dateStyle: 'long' });
  return entries.map((e) => {
    const media = e.featured_media_id ? loader.media.get(e.featured_media_id) : undefined;
    const image = media ? downsize(media, 'medium_large').path : '';
    const excerpt = words(strip(e.excerpt_rendered ?? e.excerpt ?? '') || strip(text.get(e.id) ?? ''), 30);
    return {
      title: strip(e.title_rendered ?? e.title),
      link: base + permalink(e),
      when: q.showDate !== false && e.published_at ? date.format(new Date(e.published_at)) : '',
      image: image ? base + mediaUrl(image) : undefined,
      alt: media?.alt || undefined,
      excerpt: excerpt || undefined,
    };
  });
}

/** Each Entries block's entries, by block id. `since`: a digest's last issue (for blocks showing only new entries). */
export async function emailEntries(db: SupabaseClient, doc: EmailDoc | null | undefined, origin: string, since: string | null = null): Promise<Record<string, EmailEvent[]>> {
  const blocks = entryBlocks(doc?.content);
  if (!blocks.length) return {};
  const events = await eventsOnIn(db);
  const out: Record<string, EmailEvent[]> = {};
  for (const b of blocks) {
    out[b.props.id] = await load(db, (b.props.query ?? {}) as EmailEntriesQuery, origin, since, events).catch((e) => (console.error(`email entries: ${e.message}`), []));
  }
  return out;
}
