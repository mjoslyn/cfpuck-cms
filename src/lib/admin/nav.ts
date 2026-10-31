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
 * of its own, Templates; Compose, for each thing it makes (an entry of a type with a page, `composable`,
 * then a form and, while Mailing is on, a campaign, then a template, part or pattern); optional features
 * only while they are on; admin screens to admins.
 */
export function adminNav(o: { isAdmin: boolean; ticketsOn: boolean; mailOn: boolean; membersOn: boolean; types: { type: string; label: string }[]; composable: { type: string; singular: string }[] }): NavItem[] {
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
    { label: 'Content', items: [...o.types.map((t) => ({ href: contentHref(t.type), label: t.label })), { href: contentHref('terms'), label: 'Taxonomies' }, { href: '/admin/templates/', label: 'Templates', section: true }], also: ['/admin/content', '/admin/edit'] },
    {
      label: 'Compose',
      items: [
        ...o.composable.map((t) => ({ href: `/admin/compose/?type=${t.type}`, label: t.singular })),
        { href: '/admin/compose/new/?kind=form', label: 'Form', section: true },
        ...(o.mailOn ? [{ href: '/admin/compose/new/?kind=campaign', label: 'Campaign' }] : []),
        { href: '/admin/compose/new/?kind=template', label: 'Template', section: true },
        { href: '/admin/compose/new/?kind=part', label: 'Template part' },
        { href: '/admin/compose/new/?kind=pattern', label: 'Pattern' },
      ],
    },
    { href: '/admin/media/', label: 'Media' },
    // A group of one is just its link.
    ...groups.filter((g) => g.items.length).map((g) => (g.items.length === 1 ? g.items[0] : g)),
  ];
}

/** Whether the screen at `url` is the link's: a link with a query matches its address and query (a type
 * `page` when none is named, as Compose takes it; the content list is the home without one). */
export function navActive(n: NavItem, url: URL): boolean {
  const path = url.pathname;
  if (isGroup(n)) return n.items.some((i) => navActive(i, url)) || !!n.also?.some((p) => path.startsWith(p));
  const href = new URL(n.href, url);
  if (!href.search) return path.startsWith(href.pathname);
  // The admin's home (/admin/ with no list asked for) is none of the content list's links.
  if (path === '/admin/' && !url.searchParams.has('type')) return false;
  const value = (k: string, v: string | null) => (k === 'type' ? (v === 'tags' ? 'terms' : v || 'page') : v);
  return path === href.pathname && [...href.searchParams].every(([k, v]) => value(k, url.searchParams.get(k)) === value(k, v));
}
