// Templates, parts and patterns in the trash (src/lib/admin/template-trash.ts): what uses one, a trashed
// one rendering as missing (Loader.template, its former addresses too), restore, and delete only from
// the trash.
import { describe, expect, it } from 'vitest';
import { siteDb } from '../src/lib/db/site';
import { Loader } from '../src/lib/data';
import { deleteTemplate, restoreTemplate, templateUses, trashTemplate } from '../src/lib/admin/template-trash';
import { renameTemplate } from '../src/lib/admin/rename-template';
import { part } from '../src/render/c/structure';

const doc = (content: unknown[]) => ({ root: { props: {} }, content, zones: {} });
const block = (type: string, id: string, attrs: Record<string, unknown>) => ({ type, props: { id, attrs } });

describe('templates in the trash', () => {
  it('lists what uses a pattern or a template', async () => {
    const db = siteDb();
    await db.from('templates').insert([
      { kind: 'pattern', slug: 'promo', title: 'Promo', content: doc([block('heading', 'h', { content: 'Sale' })]) },
      { kind: 'template', slug: 'landing', title: 'Landing', content: doc([block('pattern', 'p', { slug: 'promo' })]) },
    ]);
    await db.from('entries').insert([
      { type: 'page', slug: 'offers', title: 'Offers', status: 'publish', content: doc([block('pattern', 'p', { slug: 'promo' })]), template: 'landing' },
      { type: 'page', slug: 'old', title: 'Old', status: 'trash', content: doc([block('pattern', 'p', { slug: 'promo' })]) },
      { type: 'page', slug: 'mention', title: 'Mention', status: 'publish', content: doc([block('text', 't', { content: '"promo"' })]) },
    ]);
    await db.from('settings').upsert({ key: 'site', value: { templates: { page: { single: 'landing' } } } });
    expect(await templateUses(db, 'pattern', 'promo')).toEqual({ entries: ['Offers'], templates: ['Landing'], settings: false, terms: [] });
    expect(await templateUses(db, 'template', 'landing')).toEqual({ entries: ['Offers'], templates: [], settings: true, terms: [] });
  });

  it('renders a trashed one as missing until it is restored, and deletes only from the trash', async () => {
    const db = siteDb();
    await db.from('templates').insert({ kind: 'part', slug: 'banner', title: 'Banner', content: doc([block('heading', 'h', { content: 'Hi' })]) });
    await renameTemplate(db, 'part', 'banner', { title: 'Top banner', slug: 'top-banner' });
    await expect(deleteTemplate(db, 'part', 'top-banner')).rejects.toThrow('Move it to the trash first.');
    const { data: before } = await db.from('templates').select('updated_at').eq('slug', 'top-banner').single();
    await trashTemplate(db, 'part', 'top-banner');
    expect(await new Loader(db).template('part', 'top-banner')).toBeNull();
    expect(await new Loader(db).template('part', 'banner')).toBeNull();
    await restoreTemplate(db, 'part', 'top-banner');
    expect((await new Loader(db).template('part', 'banner'))?.content).toEqual([block('heading', 'h', { content: 'Hi' })]);
    expect((await db.from('templates').select('updated_at, trashed_at').eq('slug', 'top-banner').single()).data).toEqual({ updated_at: before!.updated_at, trashed_at: null });
    await trashTemplate(db, 'part', 'top-banner');
    await deleteTemplate(db, 'part', 'top-banner');
    expect((await db.from('templates').select('id').eq('slug', 'top-banner').maybeSingle()).data).toBeNull();
  });

  it('keeps a trashed one\'s address from a rename, saying where it is', async () => {
    const db = siteDb();
    await db.from('templates').insert([
      { kind: 'pattern', slug: 'faq', title: 'FAQ', content: null },
      { kind: 'pattern', slug: 'questions', title: 'Questions', content: null },
    ]);
    await trashTemplate(db, 'pattern', 'faq');
    await expect(renameTemplate(db, 'pattern', 'questions', { title: 'FAQ', slug: 'faq' })).rejects.toThrow('Another pattern has the address faq (in the trash: delete it there first).');
  });

  it('leaves no empty element for a part that isn\'t there', () => {
    const env = { ctx: { docs: new Map([['part:header', []]]) } } as any;
    expect(part({ type: 'part', id: 'hd', attrs: { slug: 'header' } } as any, env, (() => '') as any)).toBe('');
  });
});
