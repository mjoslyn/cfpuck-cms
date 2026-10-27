// Make a page from a template (entryFromTemplate): a draft of the chosen type with a copy of the
// template's blocks under ids of their own, leaving out the header, footer and Page content blocks its
// own template supplies unless asked to keep them.
import { describe, expect, it } from 'vitest';
import { siteDb } from '../src/lib/db/site';
import { entryFromTemplate } from '../src/lib/admin/duplicate';

const content = {
  root: { props: {} },
  content: [
    { type: 'part', props: { id: 'hdr', attrs: { slug: 'header' } } },
    { type: 'section', props: { id: 'band', attrs: {}, children: [
      { type: 'heading', props: { id: 'h', attrs: { level: 2, content: 'Plan your visit' } } },
      { type: 'entry-content', props: { id: 'pc', attrs: {} } },
    ] } },
    { type: 'part', props: { id: 'ftr', attrs: { slug: 'footer' } } },
  ],
};

describe('making a page from a template', () => {
  it('copies the blocks into a new draft of the chosen type', async () => {
    const db = siteDb();
    await db.from('templates').insert({ kind: 'template', slug: 'landing', title: 'Landing', content });
    const id = await entryFromTemplate(db, 'template', 'landing', 'page', 'Visit us', true);
    const { data: e } = await db.from('entries').select('type, title, slug, status, content').eq('id', id).single();
    expect(e).toMatchObject({ type: 'page', title: 'Visit us', slug: 'visit-us', status: 'draft' });
    const blocks = (e!.content as any).content;
    expect(blocks.map((b: any) => b.type)).toEqual(['section']);
    expect(blocks[0].props.children.map((b: any) => b.type)).toEqual(['heading']);
    expect(blocks[0].props.id).not.toBe('band');
    expect(blocks[0].props.children[0].props.attrs.content).toBe('Plan your visit');

    const kept = await entryFromTemplate(db, 'template', 'landing', 'page', 'Visit us', false);
    const { data: k } = await db.from('entries').select('slug, content').eq('id', kept).single();
    expect(k!.slug).toBe('visit-us-2');
    expect((k!.content as any).content.map((b: any) => b.type)).toEqual(['part', 'section', 'part']);

    // The template is unchanged.
    const { data: t } = await db.from('templates').select('content').eq('kind', 'template').eq('slug', 'landing').single();
    expect((t!.content as any).content[1].props.id).toBe('band');
  });

  it('refuses types without pages and missing templates', async () => {
    const db = siteDb();
    await expect(entryFromTemplate(db, 'template', 'landing', 'no-such-type', 'X', true)).rejects.toThrow('Choose a type');
    await expect(entryFromTemplate(db, 'template', 'gone', 'page', 'X', true)).rejects.toThrow('no longer exists');
  });
});
