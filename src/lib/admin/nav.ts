// The admin bar's menu (src/layouts/Admin.astro): a few links and dropdowns, so content types and
// features turned on don't make it longer. Settings is the gear beside it, for admins.

export interface NavLink {
  href: string;
  label: string;
  /** Starts a section of its own in a dropdown, under a rule. */
  section?: boolean;
}
export interface NavGroup {
  label: string;
  items: NavLink[];
  /** Other screens that belong to the group (an entry's editor, Compose). */
  also?: string[];
}
export type NavItem = NavLink | NavGroup;

export const isGroup = (n: NavItem): n is NavGroup => 'items' in n;

/** The content list's address for a type, or Taxonomies (`terms`). */
export const contentHref = (type: string) => `/admin/?type=${type}`;

/**
 * What the bar offers this person: Content's types (those shown, `types`), Taxonomies and, in a section
 * of its own, Templates; optional features only while they are on; admin screens to admins.
 */
export function adminNav(o: { isAdmin: boolean; ticketsOn: boolean; mailOn: boolean; membersOn: boolean; types: { type: string; label: string }[] }): NavItem[] {
  const people: NavLink[] = [
    ...(o.isAdmin ? [{ href: '/admin/users/', label: 'Users' }] : []),
    ...(o.isAdmin && o.membersOn ? [{ href: '/admin/members/', label: 'Members' }] : []),
    ...(o.mailOn ? [{ href: '/admin/mailing-lists/', label: 'Mailing Lists' }] : []),
    ...(o.ticketsOn ? [{ href: '/admin/tickets/', label: 'Tickets' }] : []),
  ];
  const groups: NavGroup[] = [
    { label: 'Forms', items: [{ href: '/admin/forms/', label: 'Forms' }, { href: '/admin/submissions/', label: 'Submissions' }] },
    { label: 'People', items: people },
  ];
  return [
    { label: 'Content', items: [...o.types.map((t) => ({ href: contentHref(t.type), label: t.label })), { href: contentHref('terms'), label: 'Taxonomies' }, { href: '/admin/templates/', label: 'Templates', section: true }], also: ['/admin/content', '/admin/compose', '/admin/edit'] },
    { href: '/admin/media/', label: 'Media' },
    // A group of one is just its link.
    ...groups.filter((g) => g.items.length).map((g) => (g.items.length === 1 ? g.items[0] : g)),
  ];
}

/** Whether the screen at `url` is the link's (a content list by its type; `page` when none is named). */
export function navActive(n: NavItem, url: URL): boolean {
  const path = url.pathname;
  if (isGroup(n)) return n.items.some((i) => navActive(i, url)) || !!n.also?.some((p) => path.startsWith(p));
  const href = new URL(n.href, url);
  if (n.href.startsWith('/admin/?')) {
    const type = (t: string | null) => (t === 'tags' ? 'terms' : t || 'page');
    return path === '/admin/' && type(url.searchParams.get('type')) === type(href.searchParams.get('type'));
  }
  return path.startsWith(href.pathname);
}
