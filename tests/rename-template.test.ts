// Renaming a template, part or pattern (renameTemplate): the name changes, the slug and the stored
// version an open editor is based on stay.
import { describe, expect, it } from 'vitest';
import { siteDb } from '../src/lib/db/site';
import { renameTemplate, TEMPLATE_TITLE_MAX } from '../src/lib/admin/rename-template';

describe('renaming a template', () => {
  it('changes its name and keeps its slug and version', async () => {
    const db = siteDb();
    await db.from('templates').insert({ kind: 'part', slug: 'header', title: 'Header', content: { root: { props: {} }, content: [] } });
    const { data: before } = await db.from('templates').select('updated_at').eq('kind', 'part').eq('slug', 'header').single();
    await new Promise((r) => setTimeout(r, 5));
    expect(await renameTemplate(db, 'part', 'header', '  Site   header ')).toBe('Site header');
    const { data: after } = await db.from('templates').select('slug, title, updated_at').eq('kind', 'part').eq('slug', 'header').single();
    expect(after).toEqual({ slug: 'header', title: 'Site header', updated_at: before!.updated_at });
  });

  it('refuses an empty name and a template that isn\'t there, and cuts a long one', async () => {
    const db = siteDb();
    await db.from('templates').insert({ kind: 'pattern', slug: 'cta', title: 'Call to action', content: null });
    await expect(renameTemplate(db, 'pattern', 'cta', '   ')).rejects.toThrow('Give it a name.');
    await expect(renameTemplate(db, 'pattern', 'gone', 'New')).rejects.toThrow('no longer exists');
    expect(await renameTemplate(db, 'pattern', 'cta', 'x'.repeat(200))).toHaveLength(TEMPLATE_TITLE_MAX);
  });
});
