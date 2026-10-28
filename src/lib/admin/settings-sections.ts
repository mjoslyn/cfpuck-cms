// Settings' sections, in the groups of its side menu, each at its own address (/admin/settings/<id>/).
// Safe in the browser: the screen (src/puck/SiteSettings.tsx) and its page both read it.

export interface SettingsSection {
  id: string;
  label: string;
}

export const SETTINGS_GROUPS: { label: string; sections: SettingsSection[] }[] = [
  {
    label: 'Site',
    sections: [
      { id: 'general', label: 'General' },
      { id: 'menu', label: 'Menu' },
      { id: 'social', label: 'Social' },
      { id: 'search', label: 'Search' },
      { id: 'types', label: 'Types' },
      { id: 'site', label: 'Site options' },
    ],
  },
  {
    label: 'Features',
    sections: [
      { id: 'events', label: 'Events' },
      { id: 'tickets', label: 'Tickets' },
      { id: 'members', label: 'Members' },
      { id: 'mailing-lists', label: 'Mailing Lists' },
    ],
  },
  { label: 'Services', sections: [{ id: 'connections', label: 'Connections' }] },
  {
    label: 'Admin',
    sections: [
      { id: 'accessibility', label: 'Accessibility' },
      { id: 'appearance', label: 'Appearance' },
    ],
  },
  {
    label: 'Upkeep',
    sections: [
      { id: 'redirects', label: 'Redirects' },
      { id: 'sync', label: 'Sync' },
      { id: 'backups', label: 'Backups' },
    ],
  },
];

export const SETTINGS_SECTIONS = SETTINGS_GROUPS.flatMap((g) => g.sections);

/** Sections that save as they go (their own buttons), with no use for Save settings. */
export const SAVES_AS_IT_GOES = new Set(['connections', 'redirects', 'sync', 'backups']);

/** Old names of sections (the Admin tab is Appearance now). */
const RENAMED: Record<string, string> = { admin: 'appearance' };

export const settingsPath = (id: string) => (id === 'general' ? '/admin/settings/' : `/admin/settings/${id}/`);

/**
 * The section an address names: /admin/settings/<id>/, or a link from before sections had addresses
 * (/admin/settings/#<id>). Null for an address under Settings that names none; '' for Settings itself.
 */
export function sectionOf(pathname: string, hash = ''): string | null {
  const rest = pathname.replace(/^\/admin\/settings\/?/, '').replace(/\/+$/, '');
  const named = rest || hash.replace(/^#/, '');
  if (!named) return '';
  const id = RENAMED[named] ?? named;
  return SETTINGS_SECTIONS.some((s) => s.id === id) ? id : rest ? null : '';
}
