// The site's menu (Settings > Menu, kept in settings.options.menu_items) for the Navigation block. Each
// item is a link; one with links, an intro or cards opens a panel: a sidebar (heading, links, intro,
// "View all") and featured cards (entries picked by hand, or the latest of a type: upcoming events).
import type { FieldDef } from './site/types';
import { LISTABLE_TYPES, typeDef } from './site';

export interface MenuItem {
  label?: string;
  url?: string;
  open_new_tab?: boolean;
  links_heading?: string;
  panel_links?: { label?: string; url?: string; open_new_tab?: boolean }[];
  panel_intro?: string;
  show_view_all?: boolean;
  view_all_label?: string;
  featured_heading?: string;
  featured_items?: number[];
  /** Show the latest entries of this type as the cards (upcoming ones for events), instead of picked ones. */
  featured_latest?: string;
}

/** The menu's items as saved under Settings. */
export const menuItems = (settings: Record<string, any>): MenuItem[] => (Array.isArray(settings.options?.menu_items) ? settings.options.menu_items : []);

/** How many cards a panel shows at most. */
export const MENU_CARDS = 4;

export const MENU_FIELDS: FieldDef[] = [
  {
    key: 'menu_items',
    label: 'Menu items',
    type: 'repeater',
    itemLabel: 'label',
    itemName: 'menu item',
    fields: [
      { key: 'label', label: 'Label', type: 'text' },
      { key: 'url', label: 'Link', type: 'url' },
      { key: 'open_new_tab', label: 'Open in new tab', type: 'bool' },
      { key: 'links_heading', label: 'Links heading', type: 'text' },
      {
        key: 'panel_links',
        label: 'Links',
        type: 'repeater',
        itemLabel: 'label',
        itemName: 'link',
        fields: [
          { key: 'label', label: 'Label', type: 'text' },
          { key: 'url', label: 'Link', type: 'url' },
          { key: 'open_new_tab', label: 'Open in new tab', type: 'bool' },
        ],
      },
      { key: 'panel_intro', label: 'Intro', type: 'textarea' },
      { key: 'show_view_all', label: 'Show a "View all" link', type: 'bool' },
      { key: 'view_all_label', label: '"View all" label', type: 'text' },
      { key: 'featured_heading', label: 'Cards heading', type: 'text' },
      { key: 'featured_latest', label: 'Cards: the latest of (upcoming, for events)', type: 'select', options: LISTABLE_TYPES.map((t) => [t, typeDef(t)?.label ?? t] as [string, string]) },
      { key: 'featured_items', label: 'Cards: picked entries', type: 'entries', types: [...LISTABLE_TYPES, 'page'] },
    ],
  },
];
