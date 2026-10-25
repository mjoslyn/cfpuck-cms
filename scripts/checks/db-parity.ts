// The query layer (src/lib/db) against PostgREST, while both exist: the same queries through the
// Supabase client and through the layer, as the server, and the JSON they answer compared. Needs the
// local stack: npx tsx --env-file=.env scripts/checks/db-parity.ts
import { createClient } from '@supabase/supabase-js';
import { Db } from '../../src/lib/db/query';
import { SqlExecutor, getPool } from '../../src/lib/db/sql';
import type { Role } from '../../src/lib/db/policies';

const rest = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const db = new Db(new SqlExecutor({ role: 'service' }));
const stamp = Date.now();
let failed = 0;

const norm = (r: any) => JSON.stringify({ data: r.data, count: r.count ?? null, error: r.error ? { code: r.error.code } : null });

async function same(label: string, q: (c: any) => PromiseLike<any>) {
  const [a, b] = await Promise.all([q(rest), q(db)]);
  const ok = norm(a) === norm(b);
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) console.log(`  rest: ${norm(a).slice(0, 600)}\n  db:   ${norm(b).slice(0, 600)}`);
}

// Rows to read: terms on an entry, a contact on a list.
const { data: entry } = await rest.from('entries').select('id').order('id').limit(1).single();
const { data: terms } = await rest.from('terms').insert([
  { taxonomy: 'tag', slug: `parity-a-${stamp}`, name: `Parity A ${stamp}`, fields: {} },
  { taxonomy: 'category', slug: `parity-b-${stamp}`, name: `Parity B ${stamp}`, fields: { colour: 'red', n: 2 } },
]).select('id');
await rest.from('entry_terms').insert(terms!.map((t: any, i: number) => ({ entry_id: entry!.id, term_id: t.id, sort: i })));
const { data: list } = await rest.from('mail_lists').insert({ name: `Parity ${stamp}` }).select('id').single();
const { data: contact } = await rest.from('contacts').insert({ email: `parity-${stamp}@example.org`, first_name: 'Par', last_name: 'Ity', tags: ['a', 'b'], attributes: { city: 'Town' } }).select('id').single();
await rest.from('contact_lists').insert({ contact_id: contact!.id, list_id: list!.id, status: 'subscribed' });

try {
  await same('select *', (c) => c.from('entries').select('*').order('id'));
  await same('columns, aliases, json paths', (c) => c.from('entries').select('id, title, seo:fields->seo, linked:content->root->props->linked, fields->>venue').order('id'));
  await same('eq, neq, in', (c) => c.from('entries').select('id, type').neq('type', 'nothing').in('status', ['publish', 'draft']).eq('status', 'publish').order('id'));
  await same('empty in', (c) => c.from('entries').select('id').in('id', []));
  await same('is null, not is null', (c) => c.from('entries').select('id').is('parent_id', null).not('published_at', 'is', null).order('id'));
  await same('not in text list', (c) => c.from('entries').select('id').not('id', 'in', `(${entry!.id},-1)`).order('id'));
  await same('like, ilike, * as %', (c) => c.from('terms').select('slug').like('slug', 'parity-*').ilike('name', `%PARITY%${stamp}`).order('slug'));
  await same('or with ilike and and()', (c) => c.from('terms').select('id').or(`name.ilike.%parity a%,and(taxonomy.eq.category,slug.like.parity-%)`).order('id'));
  await same('or on json path', (c) => c.from('entries').select('id').or('fields->access->>members.is.null,fields->access->>members.neq.true').order('id'));
  await same('order desc, nulls, range', (c) => c.from('entries').select('id, published_at').order('published_at', { ascending: false, nullsFirst: false }).order('id').range(1, 2));
  await same('count exact', (c) => c.from('entries').select('id', { count: 'exact' }).order('id').limit(1));
  await same('count head', (c) => c.from('entries').select('*', { count: 'exact', head: true }).eq('status', 'publish'));
  await same('range past end with count', (c) => c.from('entries').select('id', { count: 'exact' }).order('id').range(100, 110));
  await same('single', (c) => c.from('entries').select('id, slug').eq('id', entry!.id).single());
  await same('single, none', (c) => c.from('entries').select('id').eq('id', -1).single());
  await same('maybeSingle, none', (c) => c.from('entries').select('id').eq('id', -1).maybeSingle());
  await same('maybeSingle, many', (c) => c.from('entries').select('id').maybeSingle());
  await same('embed one-to-many', (c) => c.from('entries').select('id, entry_terms(term_id, sort)').eq('id', entry!.id));
  await same('embed count', (c) => c.from('terms').select('id, name, entry_terms(count)').like('slug', `parity-%-${stamp}`).order('id'));
  await same('embed many-to-one inner with filter', (c) => c.from('entry_terms').select('term_id, terms!inner(taxonomy)').eq('entry_id', entry!.id).eq('terms.taxonomy', 'tag'));
  await same('embed inner with referenced or', (c) => c.from('entry_terms').select('entry_id, term_id, entries!inner(status)').in('term_id', terms!.map((t: any) => t.id)).eq('entries.status', 'publish').or('fields->access->>members.is.null,fields->access->>members.neq.true', { referencedTable: 'entries' }));
  await same('one-to-many inner', (c) => c.from('contacts').select('*, contact_lists!inner(list_id, status)').eq('contact_lists.list_id', list!.id).eq('contact_lists.status', 'subscribed'));
  await same('contains on array', (c) => c.from('contacts').select('id').contains('tags', ['a']).eq('id', contact!.id));
  await same('json cs in or', (c) => c.from('terms').select('id').or(`fields->>colour.eq.red,fields->n.eq.5`).like('slug', `parity-%-${stamp}`));
  await same('json cs on a path, in or', (c) => c.from('terms').select('id').or(`fields->n.cs.2,fields->colour.cs."red",fields->list.cs.["x"]`).like('slug', `parity-%-${stamp}`));
  await same('json cs on a column', (c) => c.from('terms').select('id').contains('fields', { colour: 'red' }).like('slug', `parity-%-${stamp}`));
  await same('settings', (c) => c.from('settings').select('key, value').order('key'));
  await same('timestamps', (c) => c.from('entries').select('created_at, updated_at, published_at').order('id'));
  await same('unknown column error', (c) => c.from('entries').select('nope'));

  // The functions, against the SQL functions they replace.
  const segments = [
    null,
    { match: 'all', rules: [{ type: 'tag', tags: ['A'] }] },
    { match: 'any', rules: [{ type: 'list', lists: [list!.id] }, { type: 'field', key: 'city', op: 'equals', value: 'town' }] },
    { match: 'all', rules: [{ type: 'field', key: 'city', op: 'contains', value: 'ow' }, { type: 'joined', days: 30 }, { type: 'opened', days: 7, not: true }] },
    { match: 'all', rules: [{ type: 'member', levels: ['basic'] }] },
    { match: 'all', rules: [{ type: 'source', value: '' }, { type: 'field', key: 'city', op: 'set' }] },
  ];
  await rest.from('contacts').update({ status: 'subscribed' }).eq('id', contact!.id);
  for (const [i, seg] of segments.entries()) {
    for (const members of ['any', 'members', 'non-members']) {
      await same(`mail_audience ${i} ${members}`, (c) => c.rpc('mail_audience', { p_lists: [list!.id], p_members: members, p_levels: [], p_segment: seg }).range(0, 999));
    }
  }
  await same('mail_audience, any list', (c) => c.rpc('mail_audience', { p_lists: null, p_members: 'any', p_levels: [], p_segment: null }));
  await same('mail_still_subscribed', (c) => c.rpc('mail_still_subscribed', { p_ids: [contact!.id, -1], p_lists: [list!.id] }));
  await same('campaign_stats, none', (c) => c.rpc('campaign_stats', { p_id: -1 }));
  const { data: ev } = await rest.from('entries').select('id').eq('type', 'event').limit(1).maybeSingle();
  if (ev) await same('ticket_sold', (c) => c.rpc('ticket_sold', { p_entry: ev.id, p_occurrence: '' }));
  await same('ticket_order_status, short token', (c) => c.rpc('ticket_order_status', { p_token: 'short' }));

  // Writes: each path writes its own rows; the answers are compared with ids and times left out.
  const strip = (r: any) => JSON.stringify(r.data, (k, v) => (['id', 'created_at', 'updated_at', 'slug', 'name', 'email'].includes(k) ? undefined : v));
  const write = async (label: string, q: (c: any, tag: string) => PromiseLike<any>) => {
    const [a, b] = await Promise.all([q(rest, `rest-${stamp}`), q(db, `db-${stamp}`)]);
    const ok = strip(a) === strip(b) && !!a.error === !!b.error && (a.count ?? null) === (b.count ?? null);
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok) console.log(`  rest: ${JSON.stringify(a).slice(0, 500)}\n  db:   ${JSON.stringify(b).slice(0, 500)}`);
  };
  await write('insert one, select single', (c, t) => c.from('terms').insert({ taxonomy: 'tag', slug: `w1-${t}`, name: `W1 ${t}`, fields: { a: [1, 2] } }).select().single());
  await write('insert many with missing keys', (c, t) => c.from('terms').insert([{ taxonomy: 'tag', slug: `w2-${t}`, name: `W2 ${t}` }, { taxonomy: 'tag', slug: `w3-${t}`, name: `W3 ${t}`, description: 'x' }]).select('taxonomy, description'));
  await write('update with returning', (c, t) => c.from('terms').update({ description: 'changed', fields: { b: true } }).like('slug', `w%-${t}`).select('description, fields'));
  await write('upsert on conflict', (c, t) => c.from('terms').upsert({ taxonomy: 'tag', slug: `w1-${t}`, name: `W1 ${t}`, description: 'upserted' }, { onConflict: 'taxonomy,slug' }).select('description'));
  await write('upsert ignoring duplicates', (c, t) => c.from('terms').upsert({ taxonomy: 'tag', slug: `w1-${t}`, name: `W1 ${t}` }, { onConflict: 'taxonomy,slug', ignoreDuplicates: true }).select('description'));
  await write('unique violation', (c, t) => c.from('terms').insert({ taxonomy: 'tag', slug: `w1-${t}`, name: 'dup' }));
  await write('delete with count', (c, t) => c.from('terms').delete({ count: 'exact' }).like('slug', `w%-${t}`));
  await write('text array insert', (c, t) => c.from('contacts').insert({ email: `${t}@example.org`, tags: ['x', 'y'] }).select('tags, attributes'));
  await write('delete contacts', (c, t) => c.from('contacts').delete().eq('email', `${t}@example.org`).select('email'));

  // As signed-in people: PostgREST with their session (row security) and the layer with the policies.
  for (const role of ['editor', 'admin', 'viewer'] as const) {
    const email = `parity-${role}-${stamp}@example.org`;
    const { data: made } = await rest.auth.admin.createUser({ email, password: 'parity-password-1', email_confirm: true });
    const uid = made.user!.id;
    // The same id in the site's own accounts, for the profile (PostgREST's session is Supabase Auth's).
    await db.from('users').insert({ id: uid, email });
    await db.from('profiles').insert({ id: uid, role, display_name: role });
    const person = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    await person.auth.signInWithPassword({ email, password: 'parity-password-1' });
    const mine = new Db(new SqlExecutor({ role: (role === 'viewer' ? 'none' : role) as Role, uid }));
    const as = async (label: string, q: (c: any) => PromiseLike<any>) => {
      const [a, b] = await Promise.all([q(person), q(mine)]);
      const ok = norm(a) === norm(b);
      if (!ok) failed++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${role}: ${label}`);
      if (!ok) console.log(`  rest: ${norm(a).slice(0, 400)}\n  db:   ${norm(b).slice(0, 400)}`);
    };
    try {
      await as('read entries', (c) => c.from('entries').select('id, slug').order('id'));
      await as('read settings', (c) => c.from('settings').select('key').order('key'));
      await as('read suppressions', (c) => c.from('mail_suppressions').select('*'));
      await as('read tokens', (c) => c.from('mailgun_tokens').select('*'));
      await as('read profiles', (c) => c.from('profiles').select('id, role').eq('id', uid));
      await as('embed across policies', (c) => c.from('terms').select('id, entry_terms(count)').like('slug', `parity-%-${stamp}`).order('id'));
      await as('update settings', (c) => c.from('settings').update({ updated_at: '2026-01-01T00:00:00+00:00' }).eq('key', '__none__').select('key'));
      await as('insert settings', (c) => c.from('settings').insert({ key: `parity-${role}-${stamp}-${c === person ? 'r' : 'd'}`, value: {} }).select('value'));
      await as('insert list', (c) => c.from('mail_lists').insert({ name: `Parity ${role} ${c === person ? 'r' : 'd'} ${stamp}` }).select('description'));
      await as('insert scheduled campaign', (c) => c.from('campaigns').insert({ name: `Parity ${stamp}`, status: 'scheduled' }).select('status'));
      await as('insert draft campaign', (c) => c.from('campaigns').insert({ name: `Parity ${stamp} ${c === person ? 'r' : 'd'}`, status: 'draft' }).select('status'));
      await as('schedule draft campaign', (c) => c.from('campaigns').update({ status: 'scheduled' }).eq('name', `Parity ${stamp} ${c === person ? 'r' : 'd'}`).select('status'));
      await as('rename self', (c) => c.from('profiles').update({ display_name: `P ${role}` }).eq('id', uid).select('display_name'));
      await as('promote self', (c) => c.from('profiles').update({ role: 'admin' }).eq('id', uid).select('role'));
      await as('delete submissions', (c) => c.from('form_submissions').delete().eq('id', -1).select('id'));
      await as('insert term', (c) => c.from('terms').insert({ taxonomy: 'tag', slug: `parity-${role}-${stamp}-${c === person ? 'r' : 'd'}`, name: 'P' }).select('taxonomy'));
      // Someone who isn't an editor is refused (PostgREST let them call it and count nothing).
      if (role !== 'viewer') await as('call campaign_stats', (c) => c.rpc('campaign_stats', { p_id: -1 }));
      await as('call mail_claim', (c) => c.rpc('mail_claim', { p_id: -1, p_token: 'x' }));
    } finally {
      await rest.from('campaigns').delete().like('name', `Parity ${stamp}%`);
      await rest.from('mail_lists').delete().like('name', `Parity ${role}%${stamp}`);
      await rest.from('settings').delete().like('key', `parity-${role}-${stamp}%`);
      await rest.from('terms').delete().like('slug', `parity-${role}-${stamp}%`);
      await db.from('users').delete().eq('id', uid);
      await rest.auth.admin.deleteUser(uid);
    }
  }
} finally {
  await rest.from('terms').delete().like('slug', `parity-%-${stamp}`);
  await rest.from('contacts').delete().eq('id', contact!.id);
  await rest.from('mail_lists').delete().eq('id', list!.id);
  await getPool().end();
}
console.log(failed ? `${failed} failed` : 'all the same');
process.exit(failed ? 1 : 0);
