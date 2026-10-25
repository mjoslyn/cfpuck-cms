// Server-side helpers for saving editor output.
import type { Db } from '../db/query';
import { texturize } from '../text/formatting';
import { trimWords, esc } from '../../render/html';
import type { PuckItem } from '../puck/types';
import { RECURRENCE_KEY, localToUtc, type Recurrence } from '../recurrence';
import { SITE_TZ, typesSharingAddresses } from '../site';

/** Text content of a block tree (for automatic excerpts). */
function text(items: PuckItem[]): string {
  return items
    .map((i) => {
      const a = i.props.attrs ?? {};
      const own = i.props.html?.length ? i.props.html.join(' ') : [a.content, a.text, a.caption].filter(Boolean).join(' ');
      return `${own} ${text(i.props.children ?? [])}`;
    })
    .join(' ');
}

/** get_the_excerpt(): explicit excerpt, or the first 55 words of the content + " [&hellip;]". */
export function renderedExcerpt(excerpt: string, content: PuckItem[] | undefined): string {
  if (excerpt.trim()) return excerpt;
  const words = trimWords(text(content ?? []), 55, ' [&hellip;]');
  return texturize(words);
}

export const renderedTitle = (title: string) => texturize(esc(title).replace(/&#039;/g, "'"));

/** Resolve a media URL chosen in the editor to its media row id. */
export async function mediaIdForUrl(db: Db, url: string | null | undefined): Promise<number | null> {
  if (!url) return null;
  const path = url.replace(/^.*\/media\//, '');
  const { data } = await db.from('media').select('id').eq('path', path).maybeSingle();
  return data?.id ?? null;
}

/**
 * Editor date value -> wall clock "Y-m-d H:i:s" in `tz` (the event's timezone). A value typed in the
 * editor is already wall-clock time; an untouched one is the stored UTC timestamp, read in `tz`.
 */
function wallClock(v: string, tz: string): string {
  if (!/[zZ]|[+-]\d\d:\d\d$/.test(v)) return `${v.replace('T', ' ')}:00`.slice(0, 19);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(v))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** Only well-formed recurrence rules are stored. */
function cleanRecurrence(r: any): Recurrence | null {
  if (!r || !['daily', 'weekly', 'monthly', 'yearly'].includes(r.freq)) return null;
  const dates = (a: any) => (Array.isArray(a) ? [...new Set(a.filter((d: any) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort() : []) as string[];
  const out: Recurrence = { freq: r.freq };
  if (Number(r.interval) > 1) out.interval = Math.floor(Number(r.interval));
  if (r.freq === 'weekly' && Array.isArray(r.byweekday) && r.byweekday.length) out.byweekday = [...new Set<number>(r.byweekday.map(Number).filter((d: number) => d >= 0 && d <= 6))].sort();
  if (r.freq === 'monthly' && r.monthlyBy === 'weekday') out.monthlyBy = 'weekday';
  if (/^\d{4}-\d{2}-\d{2}$/.test(r.until ?? '')) out.until = r.until;
  else if (Number(r.count) > 0) out.count = Math.floor(Number(r.count));
  if (dates(r.exclude).length) out.exclude = dates(r.exclude);
  if (dates(r.include).length) out.include = dates(r.include);
  return out;
}

/**
 * Event dates: the event_* columns (UTC, for queries) and the start/end fields (wall-clock time in the
 * event's timezone, what the calendar shows). All-day events run 00:00:00-23:59:59.
 */
export function eventDates(e: { event_start?: string | null; event_end?: string | null; event_all_day?: boolean | null }, fields: Record<string, any>) {
  const f = { ...fields };
  const recurrence = cleanRecurrence(f[RECURRENCE_KEY]);
  if (recurrence) f[RECURRENCE_KEY] = recurrence;
  else delete f[RECURRENCE_KEY];
  if (!e.event_start) return { fields: f, event_start: null, event_end: null, event_all_day: !!e.event_all_day };
  // The event's own timezone if it has one (fields.timezone), else the site's.
  const tz = f.timezone || SITE_TZ;
  let start = wallClock(e.event_start, tz);
  let end = e.event_end ? wallClock(e.event_end, tz) : start;
  if (end < start) end = start;
  if (e.event_all_day) {
    start = `${start.slice(0, 10)} 00:00:00`;
    end = `${end.slice(0, 10)} 23:59:59`;
  }
  const startUtc = localToUtc(start, tz);
  const endUtc = localToUtc(end, tz);
  // An event without a timezone of its own follows the site's (Settings), so none is stored for it.
  Object.assign(f, { start, end, all_day: !!e.event_all_day });
  return { fields: f, event_start: startUtc, event_end: endUtc, event_all_day: !!e.event_all_day };
}

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

/** An entry's current links to terms of one taxonomy. */
async function linkedTerms(db: Db, entryId: number, taxonomy: string): Promise<number[]> {
  const { data, error } = await db.from('entry_terms').select('term_id, terms!inner(taxonomy)').eq('entry_id', entryId).eq('terms.taxonomy', taxonomy);
  if (error) throw error;
  return (data ?? []).map((r) => r.term_id);
}

/** Link an entry to exactly `links` within a taxonomy. The new links go in first and only then do the
 *  others go, so a failure leaves the old links rather than none. */
async function setLinks(db: Db, entryId: number, taxonomy: string, links: { term_id: number; sort: number }[]) {
  const before = await linkedTerms(db, entryId, taxonomy);
  if (links.length) {
    const { error } = await db.from('entry_terms').upsert(links.map((l) => ({ entry_id: entryId, ...l })), { onConflict: 'entry_id,term_id' });
    if (error) throw error;
  }
  const wanted = new Set(links.map((l) => l.term_id));
  const gone = before.filter((id) => !wanted.has(id));
  if (gone.length) {
    const { error } = await db.from('entry_terms').delete().eq('entry_id', entryId).in('term_id', gone);
    if (error) throw error;
  }
}

/** Set an entry's tags by name: missing tags are created, the entry's other terms are kept. */
export async function setEntryTags(db: Db, entryId: number, names: string[]) {
  const wanted = [...new Map(names.map((n) => n.trim()).filter(Boolean).map((n) => [slugify(n), n] as const)).entries()].filter(([slug]) => slug);
  const slugs = wanted.map(([slug]) => slug);
  const find = () => db.from('terms').select('id, slug').eq('taxonomy', 'tag').in('slug', slugs.concat(['']));
  let { data: existing, error } = await find();
  if (error) throw error;
  const have = new Set((existing ?? []).map((t) => t.slug));
  const missing = wanted.filter(([slug]) => !have.has(slug)).map(([slug, name]) => ({ taxonomy: 'tag', slug, name, description: '', fields: {} }));
  if (missing.length) {
    // Two saves can make the same new tag at once: the second keeps the first's.
    const { error: e2 } = await db.from('terms').upsert(missing, { onConflict: 'taxonomy,slug', ignoreDuplicates: true });
    if (e2) throw e2;
    ({ data: existing, error } = await find());
    if (error) throw error;
  }
  const ids = new Map((existing ?? []).map((t) => [t.slug, t.id]));
  await setLinks(db, entryId, 'tag', slugs.filter((slug) => ids.has(slug)).map((slug, sort) => ({ term_id: ids.get(slug)!, sort: 100 + sort })));
}

/** Set an entry's terms of one taxonomy to `ids` (terms of other taxonomies stay), in the order given. */
export async function setEntryTerms(db: Db, entryId: number, taxonomy: string, ids: number[]) {
  const asked = [...new Set(ids.map(Number))];
  const { data: real, error } = await db.from('terms').select('id').eq('taxonomy', taxonomy).in('id', asked.concat([-1]));
  if (error) throw error;
  const known = new Set((real ?? []).map((t) => t.id));
  await setLinks(db, entryId, taxonomy, asked.filter((id) => known.has(id)).map((term_id, sort) => ({ term_id, sort })));
}

/** Whether a save is based on an older version than the stored one (`base`: the updated_at the editor loaded). */
export const isStale = (base: unknown, stored: string | null | undefined) => typeof base === 'string' && !!stored && Date.parse(base) !== Date.parse(stored);
export const STALE = 'Someone else saved this since you opened it.';

/** A slug for an entry of a type, from `base`, not used by another entry at the same addresses (base, base-2, ...). */
export async function uniqueSlug(db: Db, type: string, base: string, exceptId?: number): Promise<string> {
  let q = db.from('entries').select('slug').in('type', typesSharingAddresses(type)).like('slug', `${base}%`);
  if (exceptId) q = q.neq('id', exceptId);
  const { data } = await q;
  const used = new Set((data ?? []).map((r) => r.slug));
  let slug = base;
  for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}
