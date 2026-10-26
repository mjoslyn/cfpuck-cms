// Who may write what through the query layer (src/lib/db/policies.ts), upserts included.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionDb, siteDb } from '../src/lib/db/site';

const svc = siteDb();
const editor = sessionDb({ role: 'editor', uid: '00000000-0000-0000-0000-000000000001' });
const admin = sessionDb({ role: 'admin', uid: '00000000-0000-0000-0000-000000000002' });
const ids = { scheduled: 0, draft: 0, digest: 0 };
const campaign = async (id: number) => (await svc.from('campaigns').select('subject, status').eq('id', id).single()).data;

beforeAll(async () => {
  ids.scheduled = (await svc.from('campaigns').insert({ name: 's', subject: 'orig', status: 'scheduled' }).select('id').single()).data!.id;
  ids.draft = (await svc.from('campaigns').insert({ name: 'd', subject: 'orig', status: 'draft' }).select('id').single()).data!.id;
  ids.digest = (await svc.from('digests').insert({ name: 'dg', enabled: true }).select('id').single()).data!.id;
});
afterAll(async () => {
  await svc.from('campaigns').delete().in('id', [ids.scheduled, ids.draft]);
  await svc.from('digests').delete().eq('id', ids.digest);
});

describe('campaigns and digests', () => {
  it('refuse an editor’s upsert over a scheduled campaign', async () => {
    const { error } = await editor.from('campaigns').upsert({ id: ids.scheduled, subject: 'evil' });
    expect(error?.code).toBe('42501');
    expect(await campaign(ids.scheduled)).toEqual({ subject: 'orig', status: 'scheduled' });
  });

  it('take an editor’s upsert over a draft, but not one that schedules it', async () => {
    expect((await editor.from('campaigns').upsert({ id: ids.draft, subject: 'ok' })).error).toBeNull();
    expect(await campaign(ids.draft)).toEqual({ subject: 'ok', status: 'draft' });
    expect((await editor.from('campaigns').upsert({ id: ids.draft, status: 'scheduled' })).error?.code).toBe('42501');
  });

  it('let an editor’s update reach no scheduled campaign, and an admin’s through', async () => {
    expect((await editor.from('campaigns').update({ subject: 'evil' }).eq('id', ids.scheduled).select('id')).data).toEqual([]);
    expect((await admin.from('campaigns').upsert({ id: ids.scheduled, subject: 'admin' })).error).toBeNull();
    expect(await campaign(ids.scheduled)).toEqual({ subject: 'admin', status: 'scheduled' });
  });

  it('refuse an editor’s upsert over an enabled digest', async () => {
    expect((await editor.from('digests').upsert({ id: ids.digest, subject: 'evil' })).error?.code).toBe('42501');
  });
});

describe('other tables', () => {
  it('take an editor’s upsert on an ordinary table', async () => {
    await editor.from('entries').upsert({ type: 'post', slug: 'up', title: 'a' }, { onConflict: 'type,slug' });
    const { data } = await editor.from('entries').upsert({ type: 'post', slug: 'up', title: 'b' }, { onConflict: 'type,slug' }).select('title');
    expect(data).toEqual([{ title: 'b' }]);
    await svc.from('entries').delete().eq('slug', 'up');
  });

  it('keep redirects to admins', async () => {
    expect((await editor.from('redirects').insert({ from_path: '/x/', to_url: '/y/' })).error?.code).toBe('42501');
    expect((await admin.from('redirects').insert({ from_path: '/x/', to_url: '/y/' })).error).toBeNull();
    expect((await editor.from('redirects').select('from_path')).data).toEqual([{ from_path: '/x/' }]);
    await svc.from('redirects').delete().eq('from_path', '/x/');
  });

  it('let nobody but the server change ticket orders', async () => {
    expect((await editor.from('ticket_orders').update({ status: 'paid' }).eq('id', 1).select('id')).data).toEqual([]);
    expect((await admin.from('ticket_orders').update({ status: 'paid' }).eq('id', 1).select('id')).data).toEqual([]);
  });
});
