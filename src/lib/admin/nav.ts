// The admin bar's menu (src/layouts/Admin.astro): a few links and two dropdowns, so features turned on
// don't make it longer. Settings is the gear beside it, for admins.

export interface NavLink {
  href: string;
  label: string;
}
export interface NavGroup {
  label: string;
  items: NavLink[];
}
export type NavItem = NavLink | NavGroup;

export const isGroup = (n: NavItem): n is NavGroup => 'items' in n;

/** What the bar offers this person: optional features only while they are on, admin screens to admins. */
export function adminNav(o: { isAdmin: boolean; ticketsOn: boolean; mailOn: boolean; membersOn: boolean }): NavItem[] {
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
    { href: '/admin/', label: 'Content' },
    { href: '/admin/templates/', label: 'Templates' },
    { href: '/admin/media/', label: 'Media' },
    // A group of one is just its link.
    ...groups.filter((g) => g.items.length).map((g) => (g.items.length === 1 ? g.items[0] : g)),
  ];
}

/** Whether the screen at `path` is the link's (Content covers the content list and Compose). */
export function navActive(n: NavItem, path: string): boolean {
  if (isGroup(n)) return n.items.some((i) => navActive(i, path));
  if (n.href === '/admin/') return path === '/admin/' || path.startsWith('/admin/content') || path.startsWith('/admin/compose');
  return path.startsWith(n.href);
}
