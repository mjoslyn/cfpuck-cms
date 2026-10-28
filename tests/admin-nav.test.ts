import { describe, expect, it } from 'vitest';
import { adminNav, isGroup, navActive } from '../src/lib/admin/nav';

const labels = (o: Parameters<typeof adminNav>[0]) => adminNav(o).map((n) => (isGroup(n) ? `${n.label}: ${n.items.map((i) => i.label).join(', ')}` : n.label));

describe('admin nav', () => {
  it('keeps the bar short with every feature on', () => {
    expect(labels({ isAdmin: true, ticketsOn: true, mailOn: true, membersOn: true })).toEqual(['Content', 'Templates', 'Media', 'Forms: Forms, Submissions', 'People: Users, Members, Mailing Lists, Tickets']);
  });

  it('gives editors no admin screens, and a group of one as a link', () => {
    expect(labels({ isAdmin: false, ticketsOn: false, mailOn: false, membersOn: true })).toEqual(['Content', 'Templates', 'Media', 'Forms: Forms, Submissions']);
    expect(labels({ isAdmin: false, ticketsOn: true, mailOn: false, membersOn: false })).toEqual(['Content', 'Templates', 'Media', 'Forms: Forms, Submissions', 'Tickets']);
  });

  it('marks the screen shown, and a group holding it', () => {
    const nav = adminNav({ isAdmin: true, ticketsOn: true, mailOn: false, membersOn: false });
    const people = nav.find((n) => n.label === 'People')!;
    expect(navActive(people, '/admin/tickets/12/')).toBe(true);
    expect(navActive(nav[0], '/admin/compose/')).toBe(true);
    expect(navActive(nav[0], '/admin/templates/')).toBe(false);
  });
});
