import { describe, expect, it } from 'vitest';
import { adminNav, isGroup, navActive } from '../src/lib/admin/nav';

const types = [{ type: 'page', label: 'Pages' }, { type: 'post', label: 'Posts' }];
const composable = [{ type: 'page', singular: 'Page' }, { type: 'post', singular: 'Post' }];
const labels = (o: Omit<Parameters<typeof adminNav>[0], 'types' | 'composable'>) => adminNav({ ...o, types, composable }).map((n) => (isGroup(n) ? `${n.label}: ${n.items.map((i) => i.label).join(', ')}` : n.label));
const at = (path: string) => new URL(path, 'http://site.test');

describe('admin nav', () => {
  it('keeps the bar short with every feature on, the content types and Templates under Content', () => {
    expect(labels({ isAdmin: true, ticketsOn: true, mailOn: true, membersOn: true })).toEqual(['Content: Pages, Posts, Taxonomies, Templates', 'Compose: Page, Post, Form, Campaign, Template, Template part, Pattern', 'Media', 'Forms: Forms, Submissions', 'People: Users, Members, Mailing Lists, Tickets']);
  });

  it('gives editors no admin screens, and a group of one as a link', () => {
    expect(labels({ isAdmin: false, ticketsOn: false, mailOn: false, membersOn: true }).slice(2)).toEqual(['Media', 'Forms: Forms, Submissions']);
    expect(labels({ isAdmin: false, ticketsOn: true, mailOn: false, membersOn: false }).at(-1)).toBe('Tickets');
  });

  it('marks the screen shown, and a group holding it', () => {
    const nav = adminNav({ isAdmin: true, ticketsOn: true, mailOn: false, membersOn: false, types, composable });
    const [content] = nav;
    const people = nav.find((n) => n.label === 'People')!;
    const item = (label: string) => (isGroup(content) ? content.items.find((i) => i.label === label)! : content);
    expect(navActive(people, at('/admin/tickets/12/'))).toBe(true);
    // /admin/ on its own is the home (Compose's start), not the Pages list.
    expect(navActive(item('Pages'), at('/admin/'))).toBe(false);
    expect(navActive(item('Pages'), at('/admin/?type=page'))).toBe(true);
    expect(navActive(item('Pages'), at('/admin/?type=post'))).toBe(false);
    expect(navActive(item('Posts'), at('/admin/?type=post&status=draft'))).toBe(true);
    expect(navActive(item('Taxonomies'), at('/admin/?type=tags'))).toBe(true);
    expect(navActive(content, at('/admin/edit/4/'))).toBe(true);
    expect(navActive(content, at('/admin/compose/'))).toBe(false);
    const compose = nav.find((n) => n.label === 'Compose')!;
    const part = isGroup(compose) ? compose.items.find((i) => i.label === 'Template part')! : compose;
    const post = isGroup(compose) ? compose.items.find((i) => i.label === 'Post')! : compose;
    expect(navActive(part, at('/admin/compose/new/?kind=part'))).toBe(true);
    expect(navActive(part, at('/admin/compose/new/?kind=pattern'))).toBe(false);
    expect(navActive(post, at('/admin/compose/?type=post'))).toBe(true);
    expect(navActive(compose, at('/admin/compose/'))).toBe(true);
    expect(isGroup(compose) && compose.items.filter((i) => i.section).map((i) => i.label)).toEqual(['Form', 'Template']);
    expect(navActive(content, at('/admin/templates/part/header/'))).toBe(true);
    expect(navActive(content, at('/admin/media/'))).toBe(false);
    expect(isGroup(content) && content.items.filter((i) => i.section).map((i) => i.label)).toEqual(['Templates']);
  });
});
