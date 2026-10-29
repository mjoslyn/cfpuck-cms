// The core's optional features that add content types (Settings > Events, Settings > Shop): while one is
// off, the admin hides its types and taxonomies (what was made stays stored) and the site shows none of
// them. A site's own `product` type isn't the shop's to hide: it stays shown. Safe in the browser.
import { EVENT_TYPES } from './events/types';
import { EVENT_TAXONOMIES, eventsOn } from './events/on';
import { shopOn } from './shop/config';
import { SHOP_CORE_TAXONOMIES, SHOP_CORE_TYPES } from './site';

export interface Features {
  events: boolean;
  shop: boolean;
}

/** Which features are on, from the site settings. */
export const featuresOf = (site: Record<string, any> | null | undefined): Features => ({ events: eventsOn(site), shop: shopOn(site) });

/** Whether the admin shows a content type: those of a feature only while it is on. */
export const showsType = (type: string, f: Features) => (f.events || !EVENT_TYPES.includes(type)) && (f.shop || !SHOP_CORE_TYPES.includes(type));
/** Whether the admin shows a taxonomy: those of a feature only while it is on. */
export const showsTaxonomy = (name: string, f: Features) => (f.events || !EVENT_TAXONOMIES.includes(name)) && (f.shop || !SHOP_CORE_TAXONOMIES.includes(name));
/** The types the site leaves out while their feature is off. */
export const offTypes = (f: Features): string[] => [...(f.events ? [] : ['event']), ...(f.shop ? [] : SHOP_CORE_TYPES)];
