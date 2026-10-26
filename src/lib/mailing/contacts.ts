// The people on the mailing lists: signing up (always confirmed by email first: double opt-in),
// confirming, changing which lists they're on, unsubscribing, and an admin's erasing and importing. A
// contact's status is global (anything but subscribed: no marketing mail at all); each list has its own
// row. Server only, with the service key (public routes) or an admin's session (the Mailing screens).
import type { Db } from '../db/query';
import { site as config } from '../site';
import { sendMail } from '../forms/mail';
import { CONSENT_TEXT, EMAIL_RE, PREFERENCES_PATH, mailingSettings, nameParts, normalEmail, type Contact, type ContactField, type MailList, type MailingSettings } from './config';
import { emailHash, sign } from './tokens';
import { cleanTags } from './segments';
import { addUnsubscribe, removeSuppressions, removeUnsubscribe } from './mailgun';
import { env } from '../env';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The site's address for links in emails: SITE_URL, else the request's. */
export const mailOrigin = (fallback?: string) => (env('SITE_URL') || fallback || 'http://localhost:4321').replace(/\/$/, '');

/** Why campaigns and digests can't go out, if they can't: their links (unsubscribe among them) are made
 * without a request (scheduled runs, the jobs queue), so they need SITE_URL; under astro dev, localhost. */
export const mailOriginProblem = () =>
  (env('SITE_URL') || import.meta.env?.DEV) ? '' : 'Set SITE_URL (the site’s address) first: the links in every email, unsubscribe among them, are made from it.';

/** The site's name and mailing settings. */
export async function loadMailing(db: Db): Promise<{ name: string; settings: MailingSettings; site: Record<string, any> }> {
  const { data } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
  const site = data?.value ?? {};
  return { name: site.name || config.name, settings: mailingSettings(site), site };
}

/** The lists, in their order (public ones only, for visitors). */
export async function loadLists(db: Db, publicOnly = false): Promise<MailList[]> {
  let q = db.from('mail_lists').select('*').order('sort').order('id');
  if (publicOnly) q = q.eq('public', true);
  const { data } = await q;
  return (data ?? []) as MailList[];
}

/** A contact and their lists' statuses. */
export async function loadContact(db: Db, id: number): Promise<{ contact: Contact; lists: Map<number, string> } | null> {
  const [{ data: contact }, { data: rows }] = await Promise.all([db.from('contacts').select('*').eq('id', id).maybeSingle(), db.from('contact_lists').select('list_id, status').eq('contact_id', id)]);
  if (!contact) return null;
  return { contact: contact as Contact, lists: new Map((rows ?? []).map((r) => [Number(r.list_id), String(r.status)])) };
}

export async function contactByEmail(db: Db, email: string): Promise<Contact | null> {
  const { data } = await db.from('contacts').select('*').eq('email', normalEmail(email)).maybeSingle();
  return (data as Contact | null) ?? null;
}

export interface SignUp {
  email: string;
  first_name?: string;
  last_name?: string;
  /** A whole name, split when first and last aren't given. */
  name?: string;
  /** Values for the site's contact fields (cleaned by the caller), set on a new or unconfirmed contact. */
  attributes?: Record<string, string>;
  /** Lists asked for (ids); others are ignored. */
  lists: number[];
  /** form:<id>, subscribe:<path>, members, account... */
  source: string;
  consentText?: string;
  ip?: string;
  /** The site's address, for the confirmation link. */
  origin: string;
  /** Tags for the sign-up (a Subscribe block's), added to a new or unconfirmed contact. */
  tags?: string[];
}

export type SignUpResult = { ok: true; sent: boolean } | { ok: false; error: string };

/**
 * Someone asks to join some lists. A new address (or one that isn't subscribed) waits for confirmation;
 * a subscribed one's new lists wait too, and the confirmation email covers them. Nothing tells the
 * visitor whether the address was known: the answer is the same either way.
 */
export async function signUp(db: Db, s: SignUp): Promise<SignUpResult> {
  const email = normalEmail(s.email);
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Enter your email address.' };
  const offered = await loadLists(db);
  const lists = [...new Set(s.lists)].filter((id) => offered.some((l) => l.id === id));
  if (!lists.length) return { ok: false, error: 'Choose what you’d like to receive.' };
  const names = nameParts(s);
  const fields = Object.fromEntries(Object.entries(s.attributes ?? {}).filter(([, v]) => v));
  const consent = { consent_source: s.source.slice(0, 200), consent_text: (s.consentText || CONSENT_TEXT).slice(0, 1000), consent_at: new Date().toISOString(), consent_ip: (s.ip ?? '').slice(0, 64) };
  let contact = await contactByEmail(db, email);
  if (!contact) {
    const { data, error } = await db.from('contacts').insert({ email, ...names, status: 'pending', tags: cleanTags(s.tags ?? []), attributes: fields, ...consent }).select('*').single();
    // Two sign-ups at once: the other one made the row.
    if (error?.code === '23505') contact = await contactByEmail(db, email);
    else if (error) return { ok: false, error: error.message };
    else contact = data as Contact;
  } else if (contact.status !== 'subscribed') {
    // Tags and fields only for an address not yet confirmed: a form can't change someone already subscribed.
    await db
      .from('contacts')
      .update({ ...consent, ...(!contact.name && (names.first_name || names.last_name) ? names : {}), ...(s.tags?.length ? { tags: cleanTags([...(contact.tags ?? []), ...s.tags]) } : {}), ...(Object.keys(fields).length ? { attributes: mergeFields(contact.attributes, fields) } : {}) })
      .eq('id', contact.id);
  } else if (!contact.name && (names.first_name || names.last_name)) {
    await db.from('contacts').update(names).eq('id', contact.id);
  }
  if (!contact) return { ok: false, error: 'Something went wrong. Please try again.' };
  const { data: rows } = await db.from('contact_lists').select('list_id, status').eq('contact_id', contact.id);
  const have = new Map((rows ?? []).map((r) => [Number(r.list_id), String(r.status)]));
  const subscribed = contact.status === 'subscribed';
  const wanted = lists.filter((id) => !(subscribed && have.get(id) === 'subscribed'));
  if (!wanted.length) return { ok: true, sent: false };
  const { error } = await db.from('contact_lists').upsert(
    wanted.map((list_id) => ({ contact_id: contact!.id, list_id, status: have.get(list_id) === 'subscribed' ? 'subscribed' : 'pending' })),
    { onConflict: 'contact_id,list_id' },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, sent: await sendConfirmation(db, contact, offered.filter((l) => wanted.includes(l.id)), s.origin) };
}

/** The confirmation email, at most 3 a day to one address. Sent over SMTP like the site's other transactional mail. */
async function sendConfirmation(db: Db, contact: Contact, lists: MailList[], origin: string): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: row } = await db.from('contacts').select('confirm_day, confirm_count').eq('id', contact.id).single();
  const count = row?.confirm_day === today ? Number(row.confirm_count) : 0;
  if (count >= 3) return false;
  await db.from('contacts').update({ confirm_day: today, confirm_count: count + 1 }).eq('id', contact.id);
  const { name } = await loadMailing(db);
  const link = `${origin}${PREFERENCES_PATH}?confirm=${sign('confirm', contact.id)}`;
  const which = lists.map((l) => l.name).join(', ');
  const html =
    `<p>Please confirm that you’d like to receive ${esc(which)} from ${esc(name)} at ${esc(contact.email)}.</p>` +
    `<p><a href="${esc(link)}" style="display:inline-block;padding:10px 20px;background:#1f6672;color:#ffffff;text-decoration:none;border-radius:4px">Confirm my subscription</a></p>` +
    `<p style="color:#64748b;font-size:14px">If you didn’t ask for this, ignore this email: you won’t hear from us.</p>`;
  return sendMail({ to: [contact.email], subject: `Confirm your subscription to ${name}`, html, fromName: name }).catch((e) => {
    console.error(`mailing: confirmation email failed: ${e.message}`);
    return false;
  });
}

/**
 * The confirmation email again (an admin's Resend confirmation), for a contact with lists still waiting
 * for it: the same email and limit as a sign-up's. Never to an address that bounced or complained.
 */
export async function resendConfirmation(db: Db, id: number, origin: string): Promise<{ ok: boolean; error?: string }> {
  const found = await loadContact(db, id);
  if (!found) return { ok: false, error: 'No such contact.' };
  const { contact } = found;
  if (contact.status === 'bounced' || contact.status === 'complained') return { ok: false, error: `${contact.email} ${contact.status === 'bounced' ? 'bounced' : 'marked an email as spam'}, so nothing more is sent to them.` };
  const { data: rows } = await db.from('contact_lists').select('list_id').eq('contact_id', id).eq('status', 'pending');
  const waiting = new Set((rows ?? []).map((r) => Number(r.list_id)));
  const lists = (await loadLists(db)).filter((l) => waiting.has(l.id));
  if (!lists.length) return { ok: false, error: 'Nothing is waiting for their confirmation.' };
  return (await sendConfirmation(db, contact, lists, origin)) ? { ok: true } : { ok: false, error: 'Not sent: they already had 3 confirmation emails today, or the email failed.' };
}

/** A confirmation link was followed (and its button pressed): the contact and their waiting lists are subscribed. */
export async function confirm(db: Db, id: number): Promise<Contact | null> {
  const found = await loadContact(db, id);
  if (!found) return null;
  const now = new Date().toISOString();
  const { contact } = found;
  await db.from('contacts').update({ status: 'subscribed', confirmed_at: now, unsubscribed_at: null }).eq('id', id);
  await db.from('contact_lists').update({ status: 'subscribed', subscribed_at: now, unsubscribed_at: null }).eq('contact_id', id).eq('status', 'pending');
  // A confirmed sign-up lifts an earlier suppression, here and at Mailgun.
  await db.from('mail_suppressions').delete().eq('email_hash', emailHash(contact.email));
  if (contact.status !== 'subscribed') await removeSuppressions(contact.email).catch((e) => console.error(`mailing: Mailgun suppression removal failed: ${e.message}`));
  return { ...contact, status: 'subscribed', confirmed_at: now };
}

/**
 * Which public lists a contact is on, as they chose on the preferences page. Someone who unsubscribed
 * can come back this way (the link reached their inbox); bounced and complained addresses can't.
 */
export async function setLists(db: Db, id: number, chosen: number[]): Promise<{ ok: boolean; error?: string }> {
  const found = await loadContact(db, id);
  if (!found) return { ok: false, error: 'No such subscription.' };
  const { contact, lists } = found;
  const publicLists = await loadLists(db, true);
  const now = new Date().toISOString();
  const on = publicLists.filter((l) => chosen.includes(l.id)).map((l) => l.id);
  if (on.length && ['bounced', 'complained'].includes(contact.status)) return { ok: false, error: 'We can’t send to this address any more. Sign up again to start receiving email.' };
  if (on.length && contact.status !== 'subscribed') {
    if (contact.status === 'pending') return { ok: false, error: 'Confirm your subscription first: the link is in the email we sent.' };
    await db.from('contacts').update({ status: 'subscribed', unsubscribed_at: null, consent_source: 'preferences', consent_at: now }).eq('id', id);
    await removeUnsubscribe(contact.email).catch((e) => console.error(`mailing: Mailgun unsubscribe removal failed: ${e.message}`));
  }
  const changed = publicLists.filter((l) => on.includes(l.id) !== (lists.get(l.id) === 'subscribed')).map((l) => l.id);
  const join = changed.filter((l) => on.includes(l));
  const leave = changed.filter((l) => !on.includes(l) && lists.has(l));
  // Separate writes: a bulk upsert writes the same columns to every row.
  if (join.length) {
    const { error } = await db.from('contact_lists').upsert(join.map((list_id) => ({ contact_id: id, list_id, status: 'subscribed', subscribed_at: now, unsubscribed_at: null })), { onConflict: 'contact_id,list_id' });
    if (error) return { ok: false, error: error.message };
  }
  if (leave.length) {
    const { error } = await db.from('contact_lists').update({ status: 'unsubscribed', unsubscribed_at: now }).eq('contact_id', id).in('list_id', leave);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Every list a contact is on (or waiting for) set to unsubscribed: they unsubscribed, bounced or complained. */
export async function leaveAllLists(db: Db, ids: number[], at = new Date().toISOString()): Promise<void> {
  if (!ids.length) return;
  const { error } = await db.from('contact_lists').update({ status: 'unsubscribed', unsubscribed_at: at }).in('contact_id', ids).neq('status', 'unsubscribed');
  if (error) throw new Error(error.message);
}

/** Unsubscribe from everything (or one list), at once; the campaign it came from records it. */
export async function unsubscribe(db: Db, id: number, opts: { list?: number; campaign?: number } = {}): Promise<boolean> {
  const now = new Date().toISOString();
  if (opts.list) {
    const { data } = await db.from('contact_lists').update({ status: 'unsubscribed', unsubscribed_at: now }).eq('contact_id', id).eq('list_id', opts.list).select('contact_id');
    if (!data?.length) return false;
  } else {
    const { data } = await db.from('contacts').select('status').eq('id', id).maybeSingle();
    if (!data) return false;
    // Bounced and complained stay as they are: stronger than unsubscribed.
    if (!['bounced', 'complained'].includes(data.status)) await db.from('contacts').update({ status: 'unsubscribed', unsubscribed_at: now }).eq('id', id);
    await leaveAllLists(db, [id], now);
  }
  if (opts.campaign) await db.from('campaign_sends').update({ unsubscribed_at: now }).eq('campaign_id', opts.campaign).eq('contact_id', id).is('unsubscribed_at', null);
  return true;
}

/** Erase a contact (admins): their row, sends and clicks go; a hash of the address stays, so they're never mailed again without signing up anew. */
export async function erase(db: Db, id: number): Promise<{ ok: boolean; error?: string }> {
  const { data } = await db.from('contacts').select('email').eq('id', id).maybeSingle();
  if (!data) return { ok: false, error: 'No such contact.' };
  const { error: e1 } = await db.from('mail_suppressions').upsert({ email_hash: emailHash(data.email), reason: 'erased' }, { onConflict: 'email_hash' });
  if (e1) return { ok: false, error: e1.message };
  await db.from('link_clicks').delete().eq('contact_id', id);
  const { error } = await db.from('contacts').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  await addUnsubscribe(data.email).catch((e) => console.error(`mailing: Mailgun unsubscribe failed: ${e.message}`));
  return { ok: true };
}

export interface ImportRow {
  email: string;
  first_name?: string;
  last_name?: string;
  /** A whole name, split when first and last aren't given. */
  name?: string;
  /** Fields to segment by (empty values are left out). */
  attributes?: Record<string, string>;
  tags?: string[];
}

/** A contact's fields with new ones laid over them (an empty value leaves the old one). */
const mergeFields = (old: Record<string, unknown> | null | undefined, add: Record<string, string> = {}) => ({ ...(old ?? {}), ...Object.fromEntries(Object.entries(add).filter(([, v]) => v !== '')) });

/**
 * Add people to a list who agreed to it elsewhere (admins): subscribed at once, with the source named.
 * Addresses that unsubscribed (from everything or from this list), bounced, complained or were erased
 * are skipped and counted.
 */
export async function importContacts(db: Db, rows: ImportRow[], list: number, source: string): Promise<{ added: number; updated: number; skipped: string[]; invalid: string[] }> {
  const out = { added: 0, updated: 0, skipped: [] as string[], invalid: [] as string[] };
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const clean = rows.flatMap((r) => {
    const email = normalEmail(r.email);
    if (!EMAIL_RE.test(email)) return out.invalid.push(String(r.email ?? '').slice(0, 100)), [];
    if (seen.has(email)) return [];
    seen.add(email);
    return [{ ...r, email }];
  });
  for (let i = 0; i < clean.length; i += 500) {
    const chunk = clean.slice(i, i + 500);
    const [{ data: existing }, { data: suppressed }] = await Promise.all([
      db.from('contacts').select('id, email, status, first_name, last_name, tags, attributes').in('email', chunk.map((r) => r.email)),
      db.from('mail_suppressions').select('email_hash').in('email_hash', chunk.map((r) => emailHash(r.email))),
    ]);
    const known = new Map((existing ?? []).map((c) => [c.email as string, c]));
    const blocked = new Set((suppressed ?? []).map((s) => s.email_hash as string));
    // Who unsubscribed from this list stays off it, whatever their other lists.
    const { data: left } = existing?.length ? await db.from('contact_lists').select('contact_id').eq('list_id', list).eq('status', 'unsubscribed').in('contact_id', existing.map((c) => c.id)) : { data: [] };
    const offList = new Set((left ?? []).map((r) => Number(r.contact_id)));
    const fresh: any[] = [];
    const ids: number[] = [];
    for (const r of chunk) {
      const c = known.get(r.email);
      if (blocked.has(emailHash(r.email)) || (c && (['unsubscribed', 'bounced', 'complained'].includes(c.status) || offList.has(Number(c.id))))) {
        out.skipped.push(r.email);
        continue;
      }
      if (c) {
        // Known: their tags and fields gain the import's, and a name fills an empty one.
        const patch: Record<string, unknown> = {};
        if (c.status !== 'subscribed') Object.assign(patch, { status: 'subscribed', confirmed_at: now, consent_source: source, consent_at: now });
        const tags = cleanTags([...(c.tags ?? []), ...(r.tags ?? [])]);
        if (tags.length !== (c.tags ?? []).length) patch.tags = tags;
        if (r.attributes && Object.values(r.attributes).some((v) => v !== '')) patch.attributes = mergeFields(c.attributes, r.attributes);
        const names = nameParts(r);
        if (!c.first_name && !c.last_name && (names.first_name || names.last_name)) Object.assign(patch, names);
        if (Object.keys(patch).length) await db.from('contacts').update(patch).eq('id', c.id);
        ids.push(c.id);
        out.updated++;
      } else fresh.push({ email: r.email, ...nameParts(r), attributes: mergeFields({}, r.attributes), tags: cleanTags(r.tags ?? []), status: 'subscribed', consent_source: source, consent_text: 'Imported by an admin', consent_at: now, confirmed_at: now });
    }
    if (fresh.length) {
      const { data, error } = await db.from('contacts').insert(fresh).select('id');
      if (error) throw new Error(error.message);
      ids.push(...(data ?? []).map((d) => Number(d.id)));
      out.added += fresh.length;
    }
    if (ids.length) {
      const { error } = await db.from('contact_lists').upsert(ids.map((contact_id) => ({ contact_id, list_id: list, status: 'subscribed', subscribed_at: now, unsubscribed_at: null })), { onConflict: 'contact_id,list_id' });
      if (error) throw new Error(error.message);
    }
  }
  return out;
}

/** Contacts as CSV (admins' export): one row each, with their lists. */
export function contactsCsv(contacts: (Contact & { lists: string[] })[], fields: ContactField[] = []): string {
  const cell = (v: unknown) => {
    const s = String(v ?? '');
    // A leading = + - @ would be a formula in a spreadsheet.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  // The site's fields by key (so the file imports back), then any other fields contacts have.
  const keys = [...new Set([...fields.map((f) => f.key), ...contacts.flatMap((c) => Object.keys(c.attributes ?? {}))])];
  const head = ['email', 'first_name', 'last_name', 'status', 'lists', 'tags', ...keys, 'consent_source', 'consent_at', 'confirmed_at', 'unsubscribed_at', 'created_at'];
  return [head.join(','), ...contacts.map((c) => [c.email, c.first_name, c.last_name, c.status, c.lists.join('; '), (c.tags ?? []).join('; '), ...keys.map((k) => c.attributes?.[k]), c.consent_source, c.consent_at, c.confirmed_at, c.unsubscribed_at, c.created_at].map(cell).join(','))].join('\r\n') + '\r\n';
}

/** A CSV's rows as objects by its header (lowercased); quoted fields and doubled quotes are understood. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^\uFEFF/, '');
  // The separator: whichever of comma, semicolon and tab the first line has most of.
  const first = s.split(/\r?\n/, 1)[0] ?? '';
  const delim = [',', ';', '\t'].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) row.push(cell), (cell = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell), rows.push(row), (row = []), (cell = '');
    } else cell += ch;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase());
  // No header with an email column: the first column is the address.
  if (!keys.some((k) => k === 'email' || k === 'e-mail' || k === 'email address')) return rows.filter((r) => r[0]?.trim()).map((r) => ({ email: r[0].trim(), name: (r[1] ?? '').trim() }));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k === 'e-mail' || k === 'email address' ? 'email' : k, (r[i] ?? '').trim()])));
}
