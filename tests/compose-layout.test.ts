// Compose on a layout: a template, part or pattern edited on its own, or a page edited in layout mode.
import { describe, expect, it, vi } from 'vitest';

// Claude answers with a one-section build, without the API.
vi.mock('../src/lib/compose/claude', async (actual) => ({
  ...(await actual<typeof import('../src/lib/compose/claude')>()),
  converse: vi.fn(async () => ({ text: 'Done.', tool: 'build_page', toolId: 'tu1', plan: { title: 'Layout', slug: 'layout', excerpt: '', seo: { title: 'Layout', description: 'A layout' }, sections: [{ kind: 'text', heading: 'Hello', body: 'Some words.' }] } })),
}));

import { composeTools, system, type ConverseRequest } from '../src/lib/compose/claude';
import { layoutOf, templateKey } from '../src/lib/compose/layout';
import { queueJob, runJob } from '../src/lib/compose/job';
import { siteDb } from '../src/lib/db/site';

const request = (layout?: ConverseRequest['layout']): ConverseRequest => ({ turns: [], materialBlocks: new Map(), entryType: 'page', sitePages: [], tags: [], layout });

describe('compose on layouts', () => {
  it('takes only a template, part or pattern the editor names', () => {
    expect(templateKey('part:header')).toBe('part:header');
    expect(templateKey('entry:1')).toBeNull();
    expect(templateKey('template:../x')).toBeNull();
    expect(layoutOf('{"kind":"template","slug":"front-page","page":true}')).toEqual({ kind: 'template', slug: 'front-page', page: true });
    expect(layoutOf('{"kind":"menu","slug":"x"}')).toBeNull();
    expect(layoutOf('not json')).toBeNull();
  });

  it('tells Claude it is working on a shared layout, with no field updates for one on its own', () => {
    const names = (r: ConverseRequest) => composeTools(r).map((t) => t.name);
    expect(names(request())).toContain('update_fields');
    expect(names(request({ kind: 'template', slug: 'front-page', page: true }))).toContain('update_fields');
    expect(names(request({ kind: 'part', slug: 'header', page: false }))).not.toContain('update_fields');
    expect(system(request({ kind: 'part', slug: 'header', page: false }))).toContain('the template part “header”');
    expect(system(request())).not.toContain('a layout shared by every page');
  });

  it("gives a template's build to the editor, never making a draft page of it", async () => {
    const db = siteDb();
    const before = (await db.from('entries').select('id', { count: 'exact', head: true })).count;
    const session = (await db.from('compose_sessions').insert({ template: 'part:header', entry_type: 'page', turns: [{ role: 'user', text: 'A welcome band', added: [], at: new Date().toISOString() }] }).select('id').single()).data!;
    const job = await queueJob(db, session.id, null as any, { layout: { kind: 'part', slug: 'header', page: false } });
    await runJob(job.id, job.token);
    const done = (await db.from('compose_jobs').select('status, error, result').eq('id', job.id).single()).data!;
    expect(done.error).toBeNull();
    expect(done.status).toBe('done');
    expect(done.result.entryId).toBeUndefined();
    expect(done.result.items.length).toBeGreaterThan(0);
    expect((await db.from('entries').select('id', { count: 'exact', head: true })).count).toBe(before);
  });
});
