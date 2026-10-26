// The editor's history: checkpoints and autosaves (src/lib/admin/revisions.ts), and autosaves leaving the page cache alone.
import { describe, expect, it } from 'vitest';
import { AUTOSAVE_SPAN, recordRevision, versionDoc } from '../src/lib/admin/revisions';
import { changesPages } from '../src/lib/cache';
import { siteDb } from '../src/lib/db/site';

describe('revisions', () => {
  it('keeps one autosave per stretch of editing, and a row for each checkpoint', async () => {
    const db = siteDb();
    const [a, b] = ['00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b'];
    await db.from('users').insert([{ id: a, email: 'a@example.org', name: 'A' }, { id: b, email: 'b@example.org', name: 'B' }]);
    const entry = (await db.from('entries').insert({ type: 'page', slug: 'history', title: 'History' }).select('id').single()).data!.id as number;
    const t0 = Date.parse('2026-10-26T12:00:00Z');
    const at = (ms: number) => new Date(t0 + ms);
    const save = (title: string, author: string, autosave: boolean, ms: number) => recordRevision(db, { entry_id: entry, title, content: { content: [] }, fields: {}, entry: null, action: 'draft', author_id: author }, autosave, at(ms));
    const rows = async () => (await db.from('revisions').select('title, action, created_at, saved_at').eq('entry_id', entry).order('id')).data!;

    expect((await save('one', a, true, 0)).error).toBeNull();
    await save('two', a, true, 60_000);
    expect(await rows()).toEqual([{ title: 'two', action: 'autosave', created_at: at(0).toISOString(), saved_at: at(60_000).toISOString() }]);

    // A checkpoint is a row of its own, and the autosaves after it start another.
    await save('three', a, false, 120_000);
    await save('four', a, true, 180_000);
    // Another person's autosave doesn't write over this one's.
    await save('five', b, true, 190_000);
    // Nor does one after the span: the history keeps a version every AUTOSAVE_SPAN of editing.
    await save('six', b, true, 190_000 + AUTOSAVE_SPAN);
    expect((await rows()).map((r) => [r.title, r.action])).toEqual([['two', 'autosave'], ['three', 'draft'], ['four', 'autosave'], ['five', 'autosave'], ['six', 'autosave']]);
  });

  it('restores the content areas with the content, keeping the marks made since', async () => {
    const block = (id: string) => ({ type: 'text', props: { id, attrs: {} } });
    const current = { root: { props: { a11y: { x: 1 }, 'area-sidebar': [block('now-side')], 'area-intro': [block('now-intro')] } }, content: [block('now')] };
    const saved = { root: { props: { 'area-sidebar': [block('then-side')] } }, content: [block('then')] };
    const inline = async (items: any[]) => items.map((i) => ({ ...i, inlined: true }));
    const doc = await versionDoc(current, saved, ['main', 'sidebar', 'intro'], inline);
    expect(doc.content).toEqual([{ ...block('then'), inlined: true }]);
    expect(doc.root.props).toEqual({ a11y: { x: 1 }, 'area-sidebar': [{ ...block('then-side'), inlined: true }], 'area-intro': [] });
  });

  it('keeps the template with a version saved in layout mode', async () => {
    const db = siteDb();
    const entry = (await db.from('entries').insert({ type: 'page', slug: 'layout', title: 'Layout' }).select('id').single()).data!.id as number;
    const template = { kind: 'template', slug: 'front-page', content: { root: { props: {} }, content: [{ type: 'heading', props: { id: 'h', attrs: {} } }] } };
    await recordRevision(db, { entry_id: entry, title: 'Layout', content: null, fields: {}, entry: null, action: 'save', author_id: '00000000-0000-4000-8000-00000000000a', template }, false);
    expect((await db.from('revisions').select('template').eq('entry_id', entry).single()).data!.template).toEqual(template);
  });

  it('leaves the page cache alone for autosaves only', () => {
    expect(changesPages('PUT', '/api/admin/entries/5', 'autosave')).toBe(false);
    expect(changesPages('PUT', '/api/admin/entries/5')).toBe(true);
  });
});
