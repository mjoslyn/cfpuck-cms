// Settings > Accessibility's gate (src/lib/a11y-gate.ts): bulk Publish leaves entries with a page to the
// editor, which checks them first.
import { describe, expect, it } from 'vitest';
import { POST as bulk } from '../src/pages/api/admin/entries/bulk';
import { a11ySettingsFrom, publishNeedsCheck } from '../src/lib/a11y-gate';
import { siteDb } from '../src/lib/db/site';
import { recordRevision } from '../src/lib/admin/revisions';

const run = async (ids: number[]) => {
  const form = new FormData();
  form.set('action', 'publish');
  for (const id of ids) form.append('ids', String(id));
  const res = await bulk({ request: new Request('http://x/api/admin/entries/bulk', { method: 'POST', body: form }), locals: { db: siteDb() }, redirect: (to: string, status: number) => new Response(null, { status, headers: { location: to } }) } as any);
  return new URL(res.headers.get('location')!, 'http://x').searchParams.get('notice');
};

describe('accessibility gate', () => {
  it('keeps only a known shape', () => {
    expect(a11ySettingsFrom({ block_publish: true, other: 1 })).toEqual({ block_publish: true });
    expect(a11ySettingsFrom({ block_publish: 'yes' })).toBeUndefined();
    expect(publishNeedsCheck({ a11y: { block_publish: true } }, 'page')).toBe(true);
    expect(publishNeedsCheck({}, 'page')).toBe(false);
  });

  it('holds bulk Publish of entries with a page while it is on', async () => {
    const db = siteDb();
    const id = (await db.from('entries').insert({ type: 'page', slug: 'gated', title: 'Gated' }).select('id').single()).data!.id as number;
    await db.from('settings').upsert({ key: 'site', value: { a11y: { block_publish: true } } });
    expect(await run([id])).toBe('Published: 0 entries. Skipped: Gated: publish it from the editor, where the accessibility check runs first.');
    expect((await db.from('entries').select('status').eq('id', id).single()).data!.status).toBe('draft');

    await db.from('settings').upsert({ key: 'site', value: {} });
    expect(await run([id])).toBe('Published: 1 entry.');
  });

  it('keeps the note of a publish made anyway with its version', async () => {
    const db = siteDb();
    await db.from('users').insert({ id: '00000000-0000-4000-8000-00000000000a', email: 'a@example.org', name: 'A' });
    const id = (await db.from('entries').insert({ type: 'page', slug: 'anyway', title: 'Anyway' }).select('id').single()).data!.id as number;
    const note = 'Published with 1 accessibility problem left open: urgent notice';
    expect((await recordRevision(db, { entry_id: id, title: 'Anyway', content: null, fields: {}, entry: null, action: 'publish', author_id: '00000000-0000-4000-8000-00000000000a', note }, false)).error).toBeNull();
    expect((await db.from('revisions').select('note').eq('entry_id', id).single()).data!.note).toBe(note);
  });
});
