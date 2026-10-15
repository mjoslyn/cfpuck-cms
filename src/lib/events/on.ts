// Whether the site's events are on (settings.site.events.enabled; on unless turned off). Admins turn
// them on and off under Settings > Events (saved with the other settings). Off, events
// stay stored and editable, but the site doesn't show them: no event pages, calendar views, feeds or
// ticket sales; lists, search, menus and emails leave them out; and the editor doesn't offer event or
// ticket blocks. Safe in the browser.
import type { SupabaseClient } from '@supabase/supabase-js';
import { typeDef } from '../site';

/** Blocks that show events or sell tickets: offered in the editor, and shown on the site, only while events are on. */
export const EVENT_BLOCKS = ['event-date', 'event-details', 'event-schedule', 'events-calendar', 'event-calendar', 'tickets'];

/** Whether the site has an event type and its events are on. */
export const eventsOn = (site: Record<string, any> | null | undefined): boolean => !!typeDef('event') && site?.events?.enabled !== false;

/** Whether events are on, read from the settings (for endpoints that have no loaded settings). */
export async function eventsOnIn(db: SupabaseClient): Promise<boolean> {
  const { data } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
  return eventsOn(data?.value);
}
