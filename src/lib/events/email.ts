// Events for the email builder's Events block (src/lib/forms/email.ts renders it): the next upcoming
// events (optionally of some categories, or featured ones only), or events picked by hand, each at its
// next date. The renderer is synchronous, so they are loaded here before an email is rendered, by
// block id. Past events are left out: an email can go out long after it was designed. Server only.
import type { SupabaseClient } from '@supabase/supabase-js';
import { Loader, PUBLIC_SCOPE } from '../data';
import { downsize, mediaUrl } from '../media/image';
import { permalink } from '../permalink';
import { typeDef } from '../site';
import type { Entry } from '../types';
import type { EmailDoc, EmailEvent, EmailItem } from '../forms/email';
import { eventWhen, excerptOf, toCalEvent, venueIdOf, venueLines } from './model';

/** What an Events block lists (its `query` setting). */
export interface EmailEventsQuery {
  source?: 'upcoming' | 'picked';
  /** Upcoming: how many. */
  count?: number;
  /** Upcoming: term ids of the event type's taxonomies (any of). */
  terms?: number[];
  featured?: boolean;
  /** Picked: event ids, in order. */
  include?: number[];
}

export const MAX_EMAIL_EVENTS = 12;

/** The Events blocks of a document, wherever they sit. */
function eventBlocks(items: EmailItem[] = []): EmailItem[] {
  return items.flatMap((it) => [...(it.type === 'Events' ? [it] : []), ...['content', 'left', 'right'].flatMap((slot) => (Array.isArray(it.props?.[slot]) ? eventBlocks(it.props[slot]) : []))]);
}

const ids = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : []);

async function load(db: SupabaseClient, q: EmailEventsQuery, origin: string): Promise<EmailEvent[]> {
  // Emails can go to anyone: published events that aren't members-only.
  const loader = new Loader(db, undefined, PUBLIC_SCOPE);
  const picked = q.source === 'picked';
  const include = ids(q.include).slice(0, 50);
  if (picked && !include.length) return [];
  const count = Math.min(MAX_EMAIL_EVENTS, Math.max(1, Math.round(Number(q.count) || 3)));
  const terms = ids(q.terms);
  const result = await loader.query({
    postType: 'event',
    upcoming: true,
    // Picked: every date ahead of each, to keep the next one of a series.
    perPage: picked ? 1000 : count,
    ...(picked ? { include } : {}),
    // Any of the terms, whichever taxonomy each is in.
    ...(!picked && terms.length ? { terms: { any: terms } } : {}),
    ...(!picked && q.featured ? { featuredOnly: true } : {}),
  });
  let entries = result.ids.map((id) => loader.entries.get(id)!).filter(Boolean);
  if (picked) {
    const next = new Map<number, Entry>();
    for (const e of entries) if (!next.has(e.series_id ?? e.id)) next.set(e.series_id ?? e.id, e);
    entries = include.map((id) => next.get(id)!).filter(Boolean);
  }
  const venues = new Map((await loader.entriesByIds(entries.map(venueIdOf).filter(Boolean))).map((v) => [v.id, v]));
  await loader.loadMedia(entries.map((e) => e.featured_media_id).filter(Boolean));
  const { data } = await db.from('entries').select('id, body_text').in('id', [...new Set(entries.map((e) => e.series_id ?? e.id))]);
  const text = new Map((data ?? []).map((r) => [r.id, String(r.body_text ?? '')]));
  const base = origin.replace(/\/$/, '');
  return entries.flatMap((e) => {
    const ev = toCalEvent(e, venues, loader.media, new Map(), text.get(e.series_id ?? e.id) ?? '');
    if (!ev) return [];
    const { date, time } = eventWhen(ev.start, ev.end, ev.allDay);
    const image = ev.media ? downsize(ev.media, 'medium_large').path : '';
    return [
      {
        title: e.title,
        link: base + permalink(e),
        when: date + time,
        venue: venueLines(ev.venue).slice(0, 2).join(', ') || undefined,
        image: image ? base + mediaUrl(image) : undefined,
        alt: ev.media?.alt || undefined,
        excerpt: excerptOf(ev, 30) || undefined,
      },
    ];
  });
}

// One load per query a minute, so a run of reminders or notifications doesn't repeat it for each.
const cache = new Map<string, { at: number; events: Promise<EmailEvent[]> }>();

/** Each Events block's events, by block id (empty when the document has none or the site has no events). */
export async function emailEvents(db: SupabaseClient, doc: EmailDoc | null | undefined, origin: string): Promise<Record<string, EmailEvent[]>> {
  const blocks = eventBlocks(doc?.content);
  if (!blocks.length || !typeDef('event')) return {};
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.at > 60_000) cache.delete(k);
  const out: Record<string, EmailEvent[]> = {};
  for (const b of blocks) {
    const q = (b.props.query ?? {}) as EmailEventsQuery;
    const key = JSON.stringify([origin, q.source, q.count, q.terms, q.featured, q.include]);
    if (!cache.has(key)) {
      const events = load(db, q, origin);
      // A failed load isn't kept, and doesn't stop the email: the block shows its empty text.
      events.catch(() => cache.delete(key));
      cache.set(key, { at: now, events });
    }
    out[b.props.id] = await cache.get(key)!.events.catch((e) => (console.error(`email events: ${e.message}`), []));
  }
  return out;
}
