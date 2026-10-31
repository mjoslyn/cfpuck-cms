// Whether the site's events are on (settings.site.events.enabled): an optional feature, off until an
// admin turns it on under Settings > Events. The core supplies the event and venue types and the event
// category taxonomy (src/lib/events/types.ts). Off, the admin hides them (events already made stay
// stored, and come back when Events is turned on) and the site doesn't show them: no event pages,
// calendar views, feeds or ticket sales; lists, search, menus and emails leave them out; and the editor
// doesn't offer event or ticket blocks. Safe in the browser.
import type { Db } from '../db/query';
import { site, typesOfTaxonomy } from '../site';
import { EVENT_TYPES } from './types';

/** Blocks that show events or sell tickets: offered in the editor, and shown on the site, only while events are on. */
export const EVENT_BLOCKS = ['event-date', 'event-details', 'event-schedule', 'events-calendar', 'event-calendar', 'tickets'];

/** Whether events are on. */
export const eventsOn = (site: Record<string, any> | null | undefined): boolean => site?.events?.enabled === true;

/** Whether events are on, read from the settings (for endpoints that have no loaded settings). */
export async function eventsOnIn(db: Db): Promise<boolean> {
  const { data } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
  return eventsOn(data?.value);
}

/** Taxonomies only events and venues use (event categories): hidden in the admin while events are off. */
export const eventTaxonomies = () => site.taxonomies.filter((t) => { const types = typesOfTaxonomy(t.name); return types.length > 0 && types.every((x) => EVENT_TYPES.includes(x)); }).map((t) => t.name);

/** Whether the admin shows a content type, or a taxonomy: those of Events only while it is on. */
export const showsType = (type: string, on: boolean) => on || !EVENT_TYPES.includes(type);
export const showsTaxonomy = (name: string, on: boolean) => on || !eventTaxonomies().includes(name);
