// The site timezone on the server: the admin setting (settings.site.timezone), else the site config's;
// and the taxonomies set in the admin (applyTypeSettings). Read at most once a minute per server
// instance, before a request is handled (src/middleware.ts) and before a compose job or mailing run.
import type { Db } from '../db/query';
import { siteDb } from '../db/site';
import { localToUtc } from '../recurrence';
import { allRows } from '../rows';
import { SITE_TZ, applyTypeSettings, setSiteTimezone } from './index';

let checked = 0;

export async function refreshSiteTimezone(db: Db = siteDb(), force = false): Promise<string> {
  if (!force && Date.now() - checked < 60_000) return SITE_TZ;
  checked = Date.now();
  const { data, error } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
  // A failed read keeps what was applied last, rather than dropping the admin's taxonomies.
  if (error) return SITE_TZ;
  setSiteTimezone(data?.value?.timezone);
  applyTypeSettings(data?.value);
  return SITE_TZ;
}

/**
 * After the site timezone changes from `from` to `to`: events that were on the site's timezone move
 * to the new one and keep their local times (7 pm stays 7 pm), so their UTC columns are recomputed.
 * Events with a timezone of their own are left alone. Returns how many moved.
 */
export async function moveEventsToTimezone(db: Db, from: string, to: string): Promise<number> {
  const { data, error } = await allRows(db.from('entries').select('id, fields').eq('type', 'event').order('id'));
  if (error) throw error;
  let moved = 0;
  for (const e of data ?? []) {
    const f = e.fields ?? {};
    if (f.timezone && f.timezone !== from) continue;
    const update: Record<string, any> = { fields: { ...f, timezone: to } };
    if (f.start) update.event_start = localToUtc(f.start, to);
    if (f.end ?? f.start) update.event_end = localToUtc(f.end ?? f.start, to);
    const { error: e2 } = await db.from('entries').update(update).eq('id', e.id);
    if (e2) throw e2;
    moved++;
  }
  return moved;
}
