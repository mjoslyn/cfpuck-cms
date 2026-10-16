// The Events feature's content types and taxonomy (Settings > Events, src/lib/events/on.ts). The core
// adds them to the site's config (src/lib/site), so a site needs none of them in its config.ts. A site
// changes them with its config's `events` (fields added, replaced or left out; labels, URLs...); one that
// lists its own `event`, `venue` or `event_category` keeps that whole. Safe in the browser.
import type { ContentType, EventsConfig, FieldDef, Taxonomy, TypeExtension } from '../site/types';

const ADDRESS: FieldDef[] = [
  { key: 'address', label: 'Street address', type: 'text' },
  { key: 'city', label: 'City', type: 'text' },
  { key: 'state', label: 'State', type: 'text' },
  { key: 'zip', label: 'Postal code', type: 'text' },
];

export const EVENT_TYPE: ContentType = {
  type: 'event',
  label: 'Events',
  singular: 'Event',
  base: 'event',
  archive: '/events/',
  category: 'event_category',
  describe: 'an event on the calendar (/events/): its own page with the date, venue and details beside your content',
  card: 'event',
  fields: [
    { key: 'venue', label: 'Venue', type: 'entry', entryType: 'venue', create: ADDRESS },
    { key: 'cost', label: 'Cost', type: 'text', compose: 'price as written, e.g. "$25, kids free"' },
    { key: 'website', label: 'Event website', type: 'url', compose: 'event website or tickets URL' },
    {
      key: 'schedule', label: 'Schedule', type: 'repeater', itemLabel: 'day_label', itemName: 'day',
      fields: [
        { key: 'day_label', label: 'Day', type: 'text' },
        {
          key: 'items', label: 'Items', type: 'repeater', itemLabel: 'title', itemName: 'item',
          fields: [
            { key: 'time', label: 'Time', type: 'text' },
            { key: 'title', label: 'Title', type: 'text' },
            { key: 'location', label: 'Location', type: 'text' },
            { key: 'note', label: 'Note', type: 'text' },
          ],
        },
      ],
    },
  ],
};

export const VENUE_TYPE: ContentType = {
  type: 'venue',
  label: 'Venues',
  singular: 'Venue',
  base: 'venue',
  record: true,
  fields: [...ADDRESS, { key: 'country', label: 'Country', type: 'text' }, { key: 'phone', label: 'Phone', type: 'text' }, { key: 'website', label: 'Website', type: 'url' }],
};

export const EVENT_CATEGORY: Taxonomy = { name: 'event_category', label: 'Event category', base: 'events/category' };

/** The content types that belong to Events: hidden from the admin's tabs and pickers while it is off. */
export const EVENT_TYPES = ['event', 'venue'];

/** A core type with a site's changes (its `events` config): options replaced, fields added, replaced or left out by key. */
export function extendType(base: ContentType, ext: TypeExtension | undefined): ContentType {
  if (!ext) return base;
  const { fields, removeFields, ...options } = ext;
  const drop = new Set(removeFields ?? []);
  const own = new Map((fields ?? []).map((f) => [f.key, f]));
  const merged = (base.fields ?? []).filter((f) => !drop.has(f.key)).map((f) => own.get(f.key) ?? f);
  const added = (fields ?? []).filter((f) => !(base.fields ?? []).some((b) => b.key === f.key));
  return { ...base, ...options, type: base.type, fields: [...merged, ...added] };
}

/**
 * The site's types and taxonomies with the Events feature's added: the core's event and venue types and
 * event categories, extended by the site's `events` config. A site that lists its own `event` or `venue`
 * type, or `event_category` taxonomy, keeps it whole instead.
 */
export function withEvents(types: ContentType[], taxonomies: Taxonomy[], ext: EventsConfig = {}): { types: ContentType[]; taxonomies: Taxonomy[] } {
  const has = (t: string) => types.some((c) => c.type === t);
  const add = [extendType(EVENT_TYPE, ext.event), extendType(VENUE_TYPE, ext.venue)].filter((t) => !has(t.type));
  // Before the first type without a page (records, globals), so the admin's tabs keep pages first.
  const at = types.findIndex((t) => t.record || t.pageless);
  const merged = at < 0 ? [...types, ...add] : [...types.slice(0, at), ...add, ...types.slice(at)];
  const event = merged.find((t) => t.type === 'event')!;
  const wanted = event.category === EVENT_CATEGORY.name && !taxonomies.some((t) => t.name === EVENT_CATEGORY.name);
  return { types: merged, taxonomies: wanted ? [...taxonomies, { ...EVENT_CATEGORY, ...ext.category, name: EVENT_CATEGORY.name }] : taxonomies };
}
