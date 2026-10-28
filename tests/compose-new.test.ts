// The admin bar's Compose menu makes an empty template, part or pattern to build (POST
// /api/admin/templates { action: 'create' }), each at an address no template of its kind has.
import { describe, expect, it } from 'vitest';
import { POST } from '../src/pages/api/admin/templates';
import { siteDb } from '../src/lib/db/site';

const create = (body: Record<string, unknown>) =>
  POST({ request: new Request('http://x/api/admin/templates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), locals: { db: siteDb() }, redirect: () => new Response(null) } as any);

describe('Compose a template, part or pattern', () => {
  it('makes an empty one at a free address', async () => {
    const first = await (await create({ action: 'create', kind: 'part', title: 'Holiday banner' })).json();
    const second = await (await create({ action: 'create', kind: 'part', title: 'Holiday banner' })).json();
    expect(first.slug).toBe('holiday-banner');
    expect(second.slug).toBe('holiday-banner-2');
    const { data } = await siteDb().from('templates').select('kind, title, content').eq('kind', 'part').eq('slug', 'holiday-banner').single();
    expect(data).toMatchObject({ kind: 'part', title: 'Holiday banner', content: { content: [] } });
  });

  it('refuses another kind or no name', async () => {
    expect((await create({ action: 'create', kind: 'global', title: 'X' })).status).toBe(400);
    expect((await create({ action: 'create', kind: 'pattern', title: ' ' })).status).toBe(400);
  });
});
