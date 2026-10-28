// Renaming a template, part or pattern (renameTemplate): its name and address change, the version an
// open editor is based on stays, the site's references follow the new address, and the old address still
// finds it (Loader.template).
import { describe, expect, it } from 'vitest';
import { siteDb } from '../src/lib/db/site';
import { Loader } from '../src/lib/data';
import { renameInDoc, renameTemplate, TEMPLATE_TITLE_MAX } from '../src/lib/admin/rename-template';
import { part } from '../src/render/c/structure';

const doc = (content: unknown[], root: Record<string, unknown> = {}) => ({ root: { props: root }, content, zones: {} });
const block = (type: string, id: string, attrs: Record<string, unknown>, children?: unknown[]) => ({ type, props: { id, attrs, ...(children ? { children } : {}) } });

describe('renaming a template', () => {
  it('changes its name and keeps its address and version', async () => {
    const db = siteDb();
    await db.from('templates').insert({ kind: 'part', slug: 'header', title: 'Header', content: doc([]) });
    const { data: before } = await db.from('templates').select('updated_at').eq('kind', 'part').eq('slug', 'header').single();
    await new Promise((r) => setTimeout(r, 5));
    expect(await renameTemplate(db, 'part', 'header', { title: '  Site   header ' })).toMatchObject({ title: 'Site header', slug: 'header', updated: 0 });
    const { data: after } = await db.from('templates').select('slug, title, updated_at, former_slugs').eq('kind', 'part').eq('slug', 'header').single();
    expect(after).toEqual({ slug: 'header', title: 'Site header', updated_at: before!.updated_at, former_slugs: [] });
  });

  it('refuses an empty name or address, a taken address and a template that isn\'t there, and cuts a long name', async () => {
    const db = siteDb();
    await db.from('templates').insert([
      { kind: 'pattern', slug: 'cta', title: 'Call to action', content: null },
      { kind: 'pattern', slug: 'banner', title: 'Banner', content: null },
    ]);
    await expect(renameTemplate(db, 'pattern', 'cta', { title: '   ' })).rejects.toThrow('Give it a name.');
    await expect(renameTemplate(db, 'pattern', 'cta', { title: 'CTA', slug: '!!' })).rejects.toThrow('Give it an address');
    await expect(renameTemplate(db, 'pattern', 'cta', { title: 'CTA', slug: 'Banner' })).rejects.toThrow('Another pattern has the address banner.');
    await expect(renameTemplate(db, 'pattern', 'gone', { title: 'New' })).rejects.toThrow('no longer exists');
    expect((await renameTemplate(db, 'pattern', 'cta', { title: 'x'.repeat(200) })).title).toHaveLength(TEMPLATE_TITLE_MAX);
  });

  it('moves a pattern to a new address, in every page and template that places it', async () => {
    const db = siteDb();
    const placed = (slug: string) => block('pattern', 'p1', { slug, linked: true, overrides: { h: { content: 'Hi' } } });
    await db.from('templates').insert([
      { kind: 'pattern', slug: 'signup', title: 'Sign up', content: doc([block('heading', 'h', { content: 'Join' })]) },
      { kind: 'template', slug: 'with-signup', title: 'With sign-up', content: doc([block('section', 's', {}, [placed('signup')])], { 'area-sidebar': [placed('signup')] }) },
    ]);
    const { data: e } = await db.from('entries').insert({ type: 'page', slug: 'about', title: 'About', status: 'publish', content: doc([placed('signup'), block('pattern', 'p2', { slug: 'signup-old' })]) }).select('id, updated_at').single();
    await db.from('entry_drafts').insert({ entry_id: e!.id, draft: { content: doc([placed('signup')]), entry: { title: 'About' } } });
    const done = await renameTemplate(db, 'pattern', 'signup', { title: 'Join us', slug: 'Join Us' });
    expect(done).toEqual({ title: 'Join us', slug: 'join-us', updated: 3, failed: 0 });
    const { data: tpl } = await db.from('templates').select('content').eq('slug', 'with-signup').single();
    expect((tpl!.content as any).content[0].props.children[0].props.attrs).toEqual({ slug: 'join-us', linked: true, overrides: { h: { content: 'Hi' } } });
    expect((tpl!.content as any).root.props['area-sidebar'][0].props.attrs.slug).toBe('join-us');
    const { data: entry } = await db.from('entries').select('content, updated_at').eq('id', e!.id).single();
    expect((entry!.content as any).content.map((b: any) => b.props.attrs.slug)).toEqual(['join-us', 'signup-old']);
    expect(entry!.updated_at).toBe(e!.updated_at);
    const { data: draft } = await db.from('entry_drafts').select('draft').eq('entry_id', e!.id).single();
    expect((draft!.draft as any).content.content[0].props.attrs.slug).toBe('join-us');
    expect((draft!.draft as any).entry).toEqual({ title: 'About' });
  });

  it('moves a template to a new address in the entries, Settings > Types and terms that chose it', async () => {
    const db = siteDb();
    await db.from('templates').insert({ kind: 'template', slug: 'single-post', title: '', content: doc([block('heading', 'h', { content: 'Post' })]) });
    const { data: e } = await db.from('entries').insert({ type: 'post', slug: 'hello', title: 'Hello', status: 'publish', template: 'single-post' }).select('id').single();
    await db.from('entry_drafts').insert({ entry_id: e!.id, draft: { content: doc([]), entry: { template: 'single-post' } } });
    await db.from('settings').upsert({ key: 'site', value: { name: 'Town', templates: { post: { single: 'single-post', archive: 'archive' } }, taxonomy_templates: { category: 'single-post' } } });
    const { data: t } = await db.from('terms').insert({ taxonomy: 'category', slug: 'news', name: 'News', fields: { template: 'single-post' } }).select('id').single();
    const done = await renameTemplate(db, 'template', 'single-post', { title: 'Story', slug: 'story' });
    expect(done).toMatchObject({ slug: 'story', updated: 4, failed: 0 });
    expect((await db.from('entries').select('template').eq('id', e!.id).single()).data!.template).toBe('story');
    expect(((await db.from('entry_drafts').select('draft').eq('entry_id', e!.id).single()).data!.draft as any).entry.template).toBe('story');
    const site = (await db.from('settings').select('value').eq('key', 'site').single()).data!.value as any;
    expect(site.templates.post).toEqual({ single: 'story', archive: 'archive' });
    expect(site.taxonomy_templates.category).toBe('story');
    expect(((await db.from('terms').select('fields').eq('id', t!.id).single()).data!.fields as any).template).toBe('story');
    // Posts still find it by the name the template hierarchy gives it.
    const loader = new Loader(db);
    expect((await loader.template('template', 'single-post'))?.content).toEqual([block('heading', 'h', { content: 'Post' })]);
    expect(await loader.template('template', 'single-page')).toBeNull();
  });

  it('keeps every former address, and gives an address back when it is taken again', async () => {
    const db = siteDb();
    await db.from('templates').insert({ kind: 'part', slug: 'footer', title: 'Footer', content: doc([]) });
    await renameTemplate(db, 'part', 'footer', { title: 'Site footer', slug: 'site-footer' });
    await renameTemplate(db, 'part', 'site-footer', { title: 'Bottom', slug: 'bottom' });
    expect((await db.from('templates').select('former_slugs').eq('slug', 'bottom').single()).data!.former_slugs).toEqual(['footer', 'site-footer']);
    await db.from('templates').insert({ kind: 'part', slug: 'other', title: 'Other', content: doc([]) });
    await renameTemplate(db, 'part', 'other', { title: 'Footer', slug: 'footer' });
    expect((await db.from('templates').select('former_slugs').eq('slug', 'bottom').single()).data!.former_slugs).toEqual(['site-footer']);
  });

  it('keeps a header part\'s role under its new address', () => {
    const moved = renameInDoc(doc([block('part', 'hd', { slug: 'header' })]), 'part', 'header', 'site-header')!;
    expect((moved.content as any)[0].props.attrs).toEqual({ slug: 'site-header', area: 'header' });
    expect(renameInDoc(doc([block('part', 'hd', { slug: 'header' })]), 'part', 'footer', 'x')).toBeNull();
    const env = { ctx: { docs: new Map([['part:site-header', [{ type: 'spacer', props: { id: 's', attrs: {} } }]]]), rendered: [] } } as any;
    expect(part({ type: 'part', id: 'hd', attrs: { slug: 'site-header', area: 'header' } } as any, env, (() => '') as any)).toMatch(/^<header class="c-part is-header">/);
  });
});
