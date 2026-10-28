// Keys saved under Settings > Connections (src/lib/site-keys.ts, src/lib/connections.ts): encrypted with
// a key made from AUTH_SECRET and bound to their names, readable by no role, never synced, behind the
// environment; and each service checked and set up (webhooks, a location or domain) before saving.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const sent = vi.hoisted(() => [] as { to: string[]; subject: string }[]);
vi.mock('../src/lib/forms/mail', async (actual) => ({ ...(await actual<object>()), sendMail: async (m: { to: string[]; subject: string }) => (sent.push(m), true) }));
import { sessionDb, siteDb } from '../src/lib/db/site';
import { env } from '../src/lib/env';
import { keyStatus, refreshSavedKeys, saveKeys, seal, unseal } from '../src/lib/site-keys';
import { POST as connectRoute } from '../src/pages/api/admin/connections';
import { connect, ConnectError, MAILGUN_EVENTS, publicOrigin, STRIPE_EVENTS } from '../src/lib/connections';
import { SYNC_TABLES } from '../src/lib/sync-remote';
import { changesPages } from '../src/lib/cache';

const db = siteDb();
beforeAll(() => {
  process.env.AUTH_SECRET = 'a-test-secret-that-is-long-enough-for-this';
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ['MAILGUN_REGION', 'SQUARE_ENVIRONMENT', 'ANTHROPIC_API_KEY']) delete process.env[k];
});

describe('saved keys', () => {
  it('are encrypted, bound to their name, and unreadable once AUTH_SECRET changes', async () => {
    const a = await seal('STRIPE_SECRET_KEY', 'sk_test_123');
    expect(a).toMatch(/^v1\./);
    expect(a).not.toContain('sk_test');
    expect(await seal('STRIPE_SECRET_KEY', 'sk_test_123')).not.toBe(a);
    expect(await unseal('STRIPE_SECRET_KEY', a)).toBe('sk_test_123');
    expect(await unseal('MAILGUN_API_KEY', a)).toBeNull();
    process.env.AUTH_SECRET = 'another-secret-entirely-for-this-test';
    expect(await unseal('STRIPE_SECRET_KEY', a)).toBeNull();
    process.env.AUTH_SECRET = 'a-test-secret-that-is-long-enough-for-this';
  });

  it('reach env() behind the environment, show only their last 4 characters, and can be removed', async () => {
    await saveKeys(db, { ANTHROPIC_API_KEY: 'sk-ant-secret-wxyz', MAILGUN_DOMAIN: 'mg.example.org' }, 'admin@example.org');
    expect(env('ANTHROPIC_API_KEY')).toBe('sk-ant-secret-wxyz');
    const { data: row } = await db.from('site_keys').select('value, hint, updated_by').eq('name', 'ANTHROPIC_API_KEY').single();
    expect(row!.value).not.toContain('secret');
    expect(row).toMatchObject({ hint: 'wxyz', updated_by: 'admin@example.org' });
    process.env.MAILGUN_REGION = 'eu';
    const status = await keyStatus(db);
    expect(status.ANTHROPIC_API_KEY).toMatchObject({ source: 'saved', hint: 'wxyz', updatedBy: 'admin@example.org' });
    expect(status.MAILGUN_DOMAIN).toMatchObject({ source: 'saved', hint: 'mg.example.org' });
    expect(status.MAILGUN_REGION).toEqual({ source: 'host', hint: 'eu' });
    expect(status.STRIPE_SECRET_KEY).toEqual({ source: null, hint: '' });
    expect(JSON.stringify(status)).not.toContain('sk-ant-secret');
    // The environment wins, and its settings can't be saved over here.
    process.env.ANTHROPIC_API_KEY = 'from-the-host';
    expect(env('ANTHROPIC_API_KEY')).toBe('from-the-host');
    await expect(saveKeys(db, { ANTHROPIC_API_KEY: 'x' }, 'a')).rejects.toThrow(/set by the host/);
    delete process.env.ANTHROPIC_API_KEY;
    await expect(saveKeys(db, { AUTH_SECRET: 'x' }, 'a')).rejects.toThrow(/Unknown setting/);
    await saveKeys(db, { ANTHROPIC_API_KEY: '', MAILGUN_DOMAIN: '' }, 'a');
    expect(env('ANTHROPIC_API_KEY')).toBeUndefined();
    expect((await keyStatus(db)).ANTHROPIC_API_KEY.source).toBeNull();
  });

  it('report a key saved under another AUTH_SECRET as unreadable', async () => {
    await db.from('site_keys').insert({ name: 'STRIPE_SECRET_KEY', value: 'v1.AAAAAAAAAAAAAAAA.AAAA', hint: '1234' });
    expect((await keyStatus(db)).STRIPE_SECRET_KEY.source).toBe('unreadable');
    expect(env('STRIPE_SECRET_KEY')).toBeUndefined();
    await db.from('site_keys').delete().eq('name', 'STRIPE_SECRET_KEY');
    await refreshSavedKeys(db, true);
  });

  it('are read by no role, never synced, and their changes leave the page cache alone', async () => {
    await saveKeys(db, { ANTHROPIC_API_KEY: 'sk-ant-zzzz' }, 'a');
    for (const role of ['editor', 'admin'] as const) {
      const { data } = await sessionDb({ role, uid: '00000000-0000-0000-0000-000000000009' }).from('site_keys').select('*');
      expect(data ?? []).toEqual([]);
      expect((await sessionDb({ role, uid: '00000000-0000-0000-0000-000000000009' }).from('site_keys').insert({ name: 'ANTHROPIC_API_KEY', value: 'x' })).error).toBeTruthy();
    }
    expect(SYNC_TABLES).not.toContain('site_keys');
    expect(changesPages('POST', '/api/admin/connections')).toBe(false);
    await saveKeys(db, { ANTHROPIC_API_KEY: '' }, 'a');
  });
});

/** A stand-in for the services' APIs: answers by method and path, and records the calls. */
function stub(routes: Record<string, (body: string) => [number, unknown]>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const key = `${init.method ?? 'GET'} ${u.host}${u.pathname}`;
    calls.push(key);
    const route = routes[key];
    const [status, body] = route ? route(String(init.body ?? '')) : [404, {}];
    return new Response(JSON.stringify(body), { status });
  });
  return calls;
}
const none = () => undefined;

describe('connecting a service', () => {
  it('knows which addresses webhooks can reach', () => {
    expect(publicOrigin('https://town.example.org')).toBe(true);
    for (const o of ['http://localhost:4321', 'https://localhost', 'http://town.example.org', 'https://127.0.0.1:8787', 'not a url']) expect(publicOrigin(o)).toBe(false);
  });

  it('checks a Claude key', async () => {
    stub({ 'GET api.anthropic.com/v1/models': () => [401, {}] });
    await expect(connect('anthropic', { ANTHROPIC_API_KEY: 'bad' }, none, 'https://x.org')).rejects.toThrow(ConnectError);
    stub({ 'GET api.anthropic.com/v1/models': () => [200, { data: [] }] });
    expect((await connect('anthropic', { ANTHROPIC_API_KEY: 'good' }, none, 'https://x.org')).values).toEqual({ ANTHROPIC_API_KEY: 'good' });
  });

  it('makes Stripe’s webhook afresh and keeps its secret, or skips it on a local copy', async () => {
    let made = '';
    const calls = stub({
      'GET api.stripe.com/v1/webhook_endpoints': () => [200, { data: [{ id: 'we_old', url: 'https://town.example.org/api/payments/stripe' }, { id: 'we_other', url: 'https://elsewhere.org/hook' }] }],
      'DELETE api.stripe.com/v1/webhook_endpoints/we_old': () => [200, {}],
      'POST api.stripe.com/v1/webhook_endpoints': (body) => ((made = body), [200, { id: 'we_new', secret: 'whsec_abc' }]),
    });
    const out = await connect('stripe', { STRIPE_SECRET_KEY: 'sk_test_1' }, none, 'https://town.example.org/');
    expect(out.values).toEqual({ STRIPE_SECRET_KEY: 'sk_test_1', STRIPE_WEBHOOK_SECRET: 'whsec_abc' });
    expect(out.notes[0]).toMatch(/test mode/);
    expect(calls).not.toContain('DELETE api.stripe.com/v1/webhook_endpoints/we_other');
    const sent = new URLSearchParams(made);
    expect(sent.get('url')).toBe('https://town.example.org/api/payments/stripe');
    expect(STRIPE_EVENTS.map((_, i) => sent.get(`enabled_events[${i}]`))).toEqual(STRIPE_EVENTS);
    const local = await connect('stripe', {}, (n) => (n === 'STRIPE_SECRET_KEY' ? 'sk_live_2' : undefined), 'http://localhost:4321');
    expect(local.values).toEqual({ STRIPE_SECRET_KEY: 'sk_live_2' });
    expect(local.notes.join(' ')).toMatch(/live mode.*public address/);
    await expect(connect('stripe', { STRIPE_SECRET_KEY: 'pk_live_x' }, none, 'https://x.org')).rejects.toThrow(/secret key/);
  });

  it('finds Square’s environment and asks which location when there are several', async () => {
    const routes: Record<string, (b: string) => [number, unknown]> = {
      'GET connect.squareup.com/v2/locations': () => [401, {}],
      'GET connect.squareupsandbox.com/v2/locations': () => [200, { locations: [{ id: 'L1', name: 'Main St', status: 'ACTIVE' }, { id: 'L2', name: 'Market', status: 'ACTIVE' }, { id: 'L3', name: 'Closed', status: 'INACTIVE' }] }],
      'GET connect.squareupsandbox.com/v2/webhooks/subscriptions': () => [200, { subscriptions: [] }],
      'POST connect.squareupsandbox.com/v2/webhooks/subscriptions': () => [200, { subscription: { id: 's1', signature_key: 'sig' } }],
    };
    stub(routes);
    const first = await connect('square', { SQUARE_ACCESS_TOKEN: 'tok' }, none, 'https://town.example.org');
    expect(first.values).toEqual({});
    expect(first.choose).toEqual({ name: 'SQUARE_LOCATION_ID', label: 'Location payments go to', options: [['L1', 'Main St'], ['L2', 'Market']] });
    const out = await connect('square', { SQUARE_ACCESS_TOKEN: 'tok', SQUARE_LOCATION_ID: 'L2' }, none, 'https://town.example.org');
    expect(out.values).toEqual({ SQUARE_ACCESS_TOKEN: 'tok', SQUARE_LOCATION_ID: 'L2', SQUARE_ENVIRONMENT: 'sandbox', SQUARE_WEBHOOK_SIGNATURE_KEY: 'sig', SQUARE_WEBHOOK_URL: 'https://town.example.org/api/payments/square' });
    routes['GET connect.squareupsandbox.com/v2/locations'] = () => [401, {}];
    await expect(connect('square', { SQUARE_ACCESS_TOKEN: 'bad' }, none, 'https://x.org')).rejects.toThrow(/didn’t accept/);
  });

  it('finds Mailgun’s region and domain, sets its webhooks and reads its signing key', async () => {
    const posted: string[] = [];
    const calls = stub({
      'GET api.mailgun.net/v3/domains': () => [401, {}],
      'GET api.eu.mailgun.net/v3/domains': () => [200, { items: [{ name: 'mg.town.org', state: 'active' }] }],
      'GET api.eu.mailgun.net/v5/accounts/http_signing_key': () => [200, { http_signing_key: 'sign' }],
      'POST api.eu.mailgun.net/v3/domains/mg.town.org/webhooks': (b) => (posted.push(b), new URLSearchParams(b).get('id') === 'opened' ? [400, { message: 'exists' }] : [200, {}]),
      'PUT api.eu.mailgun.net/v3/domains/mg.town.org/webhooks/opened': () => [200, {}],
    });
    const out = await connect('mailgun', { MAILGUN_API_KEY: 'key-1' }, none, 'https://town.example.org');
    expect(out.values).toEqual({ MAILGUN_API_KEY: 'key-1', MAILGUN_DOMAIN: 'mg.town.org', MAILGUN_REGION: 'eu', MAILGUN_WEBHOOK_SIGNING_KEY: 'sign' });
    expect(posted.map((b) => new URLSearchParams(b).get('id'))).toEqual(MAILGUN_EVENTS);
    expect(new URLSearchParams(posted[0]).get('url')).toBe('https://town.example.org/api/mailgun/webhook');
    expect(calls).toContain('PUT api.eu.mailgun.net/v3/domains/mg.town.org/webhooks/opened');
    expect(out.notes.at(-1)).toMatch(/sends deliveries/);
  });
});

describe('the fixes from review', () => {
  it('makes requests that arrive during a load wait for the keys', async () => {
    await db.from('site_keys').insert({ name: 'ANTHROPIC_API_KEY', value: await seal('ANTHROPIC_API_KEY', 'sk-ant-race'), hint: 'race' });
    const first = refreshSavedKeys(db, true);
    // A second request while the first is loading: it must not run without the key.
    await refreshSavedKeys(db);
    expect(env('ANTHROPIC_API_KEY')).toBe('sk-ant-race');
    await first;
    await saveKeys(db, { ANTHROPIC_API_KEY: '' }, 'a');
  });

  it('reports only the settings whose values changed', async () => {
    expect(await saveKeys(db, { ANTHROPIC_API_KEY: 'sk-ant-1' }, 'a')).toEqual(['ANTHROPIC_API_KEY']);
    expect(await saveKeys(db, { ANTHROPIC_API_KEY: 'sk-ant-1' }, 'a')).toEqual([]);
    expect(await saveKeys(db, { ANTHROPIC_API_KEY: '', MAILGUN_DOMAIN: '' }, 'a')).toEqual(['ANTHROPIC_API_KEY']);
  });

  it('keeps Stripe’s working endpoint when making a new one fails', async () => {
    const calls = stub({
      'GET api.stripe.com/v1/webhook_endpoints': () => [200, { data: [{ id: 'we_old', url: 'https://town.example.org/api/payments/stripe' }] }],
      'POST api.stripe.com/v1/webhook_endpoints': () => [500, { error: { message: 'busy' } }],
    });
    await expect(connect('stripe', { STRIPE_SECRET_KEY: 'sk_test_new' }, none, 'https://town.example.org')).rejects.toThrow(/refused the webhook/);
    expect(calls.filter((c) => c.startsWith('DELETE'))).toEqual([]);
  });

  it('keeps the webhook and its secret when the key hasn’t changed', async () => {
    const saved: Record<string, string> = { STRIPE_SECRET_KEY: 'sk_live_same', STRIPE_WEBHOOK_SECRET: 'whsec_keep' };
    const calls = stub({
      'GET api.stripe.com/v1/webhook_endpoints': () => [200, { data: [{ id: 'we_1', url: 'https://town.example.org/api/payments/stripe' }] }],
      'POST api.stripe.com/v1/webhook_endpoints/we_1': () => [200, { id: 'we_1' }],
    });
    const out = await connect('stripe', {}, (n) => saved[n], 'https://town.example.org');
    expect(out.values.STRIPE_WEBHOOK_SECRET).toBe('whsec_keep');
    expect(calls).toEqual(['GET api.stripe.com/v1/webhook_endpoints', 'POST api.stripe.com/v1/webhook_endpoints/we_1']);
    const square: Record<string, string> = { SQUARE_ACCESS_TOKEN: 'tok', SQUARE_ENVIRONMENT: 'production', SQUARE_LOCATION_ID: 'L1', SQUARE_WEBHOOK_SIGNATURE_KEY: 'sig-keep' };
    const sq = stub({
      'GET connect.squareup.com/v2/locations': () => [200, { locations: [{ id: 'L1', name: 'Main', status: 'ACTIVE' }] }],
      'GET connect.squareup.com/v2/webhooks/subscriptions': () => [200, { subscriptions: [{ id: 's1', notification_url: 'https://town.example.org/api/payments/square' }] }],
    });
    expect((await connect('square', {}, (n) => square[n], 'https://town.example.org')).values.SQUARE_WEBHOOK_SIGNATURE_KEY).toBe('sig-keep');
    expect(sq.some((c) => c.startsWith('POST') || c.startsWith('DELETE'))).toBe(false);
  });

  it('refuses a key whose region or environment the server sets otherwise, before any webhook', async () => {
    process.env.MAILGUN_REGION = 'eu';
    const calls = stub({ 'GET api.mailgun.net/v3/domains': () => [200, { items: [{ name: 'mg.town.org', state: 'active' }] }] });
    await expect(connect('mailgun', { MAILGUN_API_KEY: 'k' }, none, 'https://town.example.org')).rejects.toThrow(/sets MAILGUN_REGION to eu, but this key needs us/);
    expect(calls.some((c) => c.includes('webhooks'))).toBe(false);
    process.env.SQUARE_ENVIRONMENT = 'production';
    stub({ 'GET connect.squareup.com/v2/locations': () => [401, {}], 'GET connect.squareupsandbox.com/v2/locations': () => [200, { locations: [{ id: 'L1', name: 'Main', status: 'ACTIVE' }] }] });
    await expect(connect('square', { SQUARE_ACCESS_TOKEN: 't' }, none, 'https://town.example.org')).rejects.toThrow(/SQUARE_ENVIRONMENT/);
  });

  const route = (body: unknown) =>
    connectRoute({ request: new Request('https://town.example.org/api/admin/connections', { method: 'POST', body: JSON.stringify(body) }), locals: { user: { role: 'admin', email: 'admin@example.org' } }, url: new URL('https://town.example.org/api/admin/connections') } as any) as Promise<Response>;

  it('touches no service when keys couldn’t be saved', async () => {
    const calls = stub({ 'GET api.anthropic.com/v1/models': () => [200, {}] });
    const secret = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    const res = await route({ service: 'anthropic', values: { ANTHROPIC_API_KEY: 'k' } });
    process.env.AUTH_SECRET = secret;
    expect(res.status).toBe(503);
    expect(calls).toEqual([]);
  });

  it('emails the admins only when a key changed', async () => {
    const id = '00000000-0000-4000-8000-0000000000c1';
    await db.from('users').insert({ id, email: 'boss@example.org', name: 'Boss' });
    await db.from('profiles').upsert({ id, role: 'admin' }, { onConflict: 'id' });
    stub({ 'GET api.anthropic.com/v1/models': () => [200, {}] });
    sent.length = 0;
    expect((await route({ service: 'anthropic', values: { ANTHROPIC_API_KEY: 'sk-ant-mail' } })).status).toBe(200);
    expect(sent.map((m) => m.to)).toEqual([['boss@example.org']]);
    // The same key again, a key the host sets, and removing nothing: no email.
    await route({ service: 'anthropic', values: {} });
    process.env.ANTHROPIC_API_KEY = 'host-key';
    await route({ service: 'anthropic', values: {} });
    delete process.env.ANTHROPIC_API_KEY;
    await route({ service: 'anthropic', remove: true });
    expect(sent).toHaveLength(2);
    expect(sent[1].subject).toMatch(/disconnected/);
    expect((await route({ service: 'anthropic', remove: true })).status).toBe(200);
    expect(sent).toHaveLength(2);
  });
});
