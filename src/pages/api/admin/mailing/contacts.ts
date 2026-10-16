// Contacts (admins; see the middleware). Form posts, back to the contacts list or a contact:
// add (email, first_name, last_name, list, source note: subscribed at once, as an admin vouches for their consent);
// update (id, first_name, last_name, notes, tags, cf_<key>: the site's fields, field_key/field_value: others, lists[]: their lists); resend (id: the confirmation email again); unsubscribe (id); erase (id: gone, with a hash kept so
// they're never mailed again without signing up anew); import (file: CSV with email and name columns,
// list, source: who agreed and how); members (list, levels[], vouch: active members join a list).
// GET ?export=csv: every contact as CSV.
import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../lib/supabase';
import { contactsCsv, erase, importContacts, loadMailing, parseCsv, resendConfirmation, unsubscribe } from '../../../../lib/mailing/contacts';
import type { Contact } from '../../../../lib/mailing/config';
import { EMAIL_RE, fieldValue, normalEmail, type ContactField } from '../../../../lib/mailing/config';
import { isActive, type MemberRow } from '../../../../lib/members/config';
import { cleanTags, fieldKey } from '../../../../lib/mailing/segments';

/** CSV columns that aren't fields: the address, the name's parts, the tags and the export's own columns. */
const OWN_COLUMNS = new Set(['email', 'name', 'first name', 'first_name', 'firstname', 'last name', 'last_name', 'lastname', 'surname', 'full name', 'tags', 'tag', 'status', 'lists', 'consent_source', 'consent_at', 'confirmed_at', 'unsubscribed_at', 'created_at']);

export const POST: APIRoute = async ({ request, locals, redirect, url }) => {
  if (locals.user?.role !== 'admin') return new Response('Admins only', { status: 403 });
  const form = await request.formData();
  const action = String(form.get('action') ?? '');
  const id = Number(form.get('id')) || 0;
  const back = (msg: string, ok = false) => redirect(`${id && action !== 'erase' ? `/admin/mailing-lists/contacts/${id}/` : '/admin/mailing-lists/?tab=contacts'}${id && action !== 'erase' ? '?' : '&'}${ok ? 'ok' : 'error'}=${encodeURIComponent(msg)}`, 303);
  const db = locals.db;
  const list = Number(form.get('list')) || 0;
  const vouch = String(form.get('source') ?? '').trim().slice(0, 150);
  // Tags for everyone added (comma separated).
  const extraTags = cleanTags(String(form.get('tags') ?? ''));
  const fields: ContactField[] = (await loadMailing(db)).settings.fields ?? [];

  if (action === 'add') {
    const email = normalEmail(form.get('email'));
    if (!EMAIL_RE.test(email)) return back('Enter an email address.');
    if (!list) return back('Choose a list.');
    if (!vouch) return back('Say how they agreed to receive email.');
    const r = await importContacts(db, [{ email, first_name: String(form.get('first_name') ?? ''), last_name: String(form.get('last_name') ?? ''), tags: extraTags }], list, `admin: ${vouch}`);
    if (r.skipped.length) return back(`${email} unsubscribed, bounced, complained or was erased before: they need to sign up themselves.`);
    return back(`${email} ${r.added ? 'added' : 'updated'}.`, true);
  }
  if (action === 'import') {
    const file = form.get('file');
    if (!(file instanceof File) || !file.size) return back('Choose a CSV file.');
    if (file.size > 5 * 1024 * 1024) return back('That file is over 5 MB.');
    if (!list) return back('Choose a list.');
    if (!vouch) return back('Say how these people agreed to receive email.');
    // A tags column (separated by ; or |) tags each person; other columns become their fields: the
    // site's fields by key or label (values that don't fit the field's type are left out), others as they are.
    const byColumn = (k: string) => fields.find((f) => f.key === fieldKey(k) || f.label.toLowerCase() === k);
    const rows = parseCsv(await file.text()).map((r) => ({
      email: r.email ?? '',
      first_name: r['first name'] ?? r.first_name ?? r.firstname ?? '',
      last_name: r['last name'] ?? r.last_name ?? r.lastname ?? r.surname ?? '',
      name: r.name || r['full name'] || '',
      tags: cleanTags([...String(r.tags ?? r.tag ?? '').split(/[;|]/), ...extraTags]),
      attributes: Object.fromEntries(
        Object.entries(r)
          .filter(([k]) => !OWN_COLUMNS.has(k))
          .map(([k, v]) => {
            const f = byColumn(k);
            return f ? [f.key, fieldValue(f, v)] : [fieldKey(k), String(v).slice(0, 500)];
          })
          .filter(([k]) => k),
      ),
    }));
    try {
      const r = await importContacts(db, rows, list, `import: ${vouch} (${file.name.slice(0, 80)})`);
      return back(`${r.added} added, ${r.updated} already known${r.skipped.length ? `, ${r.skipped.length} skipped (unsubscribed, bounced or erased before)` : ''}${r.invalid.length ? `, ${r.invalid.length} not email addresses` : ''}.`, true);
    } catch (e) {
      return back((e as Error).message);
    }
  }
  if (action === 'members') {
    if (!list) return back('Choose a list.');
    if (!vouch) return back('Say how these members agreed to receive email.');
    const levels = form.getAll('levels').map(String).filter(Boolean);
    const { data } = await db.from('members').select('*');
    const rows = ((data ?? []) as MemberRow[]).filter((m) => isActive(m) && (!levels.length || levels.includes(m.level))).map((m) => ({ email: m.email, name: m.name, tags: extraTags }));
    const r = await importContacts(db, rows, list, `members: ${vouch}`);
    return back(`${r.added + r.updated} members on the list${r.skipped.length ? `; ${r.skipped.length} skipped (unsubscribed, bounced or erased before)` : ''}.`, true);
  }
  if (!id) return back('No contact.');
  if (action === 'update') {
    // Fields come as field_key / field_value pairs; an empty key or value drops the field.
    // The site's fields come as cf_<key>, each checked against its type.
    const keys = form.getAll('field_key').map(fieldKey);
    const values = form.getAll('field_value').map((v) => String(v).trim().slice(0, 500));
    const attributes = Object.fromEntries([...keys.map((k, i) => [k, values[i] ?? '']).filter(([k]) => !fields.some((f) => f.key === k)), ...fields.map((f) => [f.key, fieldValue(f, form.get(`cf_${f.key}`))])].filter(([k, v]) => k && v));
    const { error } = await db.from('contacts').update({ first_name: String(form.get('first_name') ?? '').trim().slice(0, 100), last_name: String(form.get('last_name') ?? '').trim().slice(0, 100), notes: String(form.get('notes') ?? '').slice(0, 2000), tags: cleanTags(String(form.get('tags') ?? '')), attributes }).eq('id', id);
    if (error) return back(error.message);
    // Lists: ticked ones subscribed (only while the contact is), the rest unsubscribed.
    const ticked = form.getAll('lists').map(Number);
    const { data: c } = await db.from('contacts').select('status').eq('id', id).single();
    const { data: all } = await db.from('mail_lists').select('id');
    const { data: have } = await db.from('contact_lists').select('list_id, status').eq('contact_id', id);
    const now = new Date().toISOString();
    const was = (list: number) => have?.find((h) => Number(h.list_id) === list)?.status;
    const ids = (all ?? []).map((l) => Number(l.id));
    const join = c?.status === 'subscribed' ? ids.filter((l) => ticked.includes(l) && was(l) !== 'subscribed') : [];
    const leave = ids.filter((l) => !ticked.includes(l) && was(l) && was(l) !== 'unsubscribed');
    // Separate writes: a bulk upsert writes the same columns to every row.
    if (join.length) {
      const { error: e2 } = await db.from('contact_lists').upsert(join.map((list_id) => ({ contact_id: id, list_id, status: 'subscribed', subscribed_at: now, unsubscribed_at: null })), { onConflict: 'contact_id,list_id' });
      if (e2) return back(e2.message);
    }
    if (leave.length) {
      const { error: e3 } = await db.from('contact_lists').update({ status: 'unsubscribed', unsubscribed_at: now }).eq('contact_id', id).in('list_id', leave);
      if (e3) return back(e3.message);
    }
    return back('Saved.', true);
  }
  if (action === 'resend') {
    const r = await resendConfirmation(db, id, url.origin);
    return r.ok ? back('Confirmation email sent again.', true) : back(r.error ?? 'Not sent.');
  }
  if (action === 'unsubscribe') return (await unsubscribe(db, id)) ? back('Unsubscribed from everything.', true) : back('No such contact.');
  if (action === 'erase') {
    const r = await erase(serviceClient(), id);
    return r.ok ? back('Erased. Their address is kept only as a hash, so they aren’t mailed again unless they sign up.', true) : back(r.error ?? 'Not erased.');
  }
  return back('Unknown action.');
};

export const GET: APIRoute = async ({ locals, url }) => {
  if (locals.user?.role !== 'admin') return new Response('Admins only', { status: 403 });
  if (url.searchParams.get('export') !== 'csv') return new Response('Not found', { status: 404 });
  const db = locals.db;
  const contacts: Contact[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('contacts').select('*').order('id').range(from, from + 999);
    contacts.push(...((data ?? []) as Contact[]));
    if (!data || data.length < 1000) break;
  }
  const { data: lists } = await db.from('mail_lists').select('id, name');
  const names = new Map((lists ?? []).map((l) => [Number(l.id), String(l.name)]));
  const on = new Map<number, string[]>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('contact_lists').select('contact_id, list_id').eq('status', 'subscribed').order('contact_id').range(from, from + 999);
    for (const r of data ?? []) on.set(Number(r.contact_id), [...(on.get(Number(r.contact_id)) ?? []), names.get(Number(r.list_id)) ?? String(r.list_id)]);
    if (!data || data.length < 1000) break;
  }
  const csv = contactsCsv(contacts.map((c) => ({ ...c, lists: on.get(c.id) ?? [] })), (await loadMailing(db)).settings.fields);
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="contacts-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' } });
};
