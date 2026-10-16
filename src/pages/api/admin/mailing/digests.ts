// Weekly digests (the Mailing screen and the digest editor). JSON posts { action, id, ... }: create (a
// form post from the list goes to its editor), save (editors while it is off; admins turn it on and
// change it while on), test (this week's issue as it would be now, to the signed-in editor), issue
// (admins: make this week's issue now, outside its schedule), delete (admins). Writes here don't change
// the site's pages.
import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../lib/supabase';
import { EMAIL_RE, audienceOf, mailingSettings, type Campaign, type Digest } from '../../../../lib/mailing/config';
import { runDigest } from '../../../../lib/mailing/digest';
import { sendTest } from '../../../../lib/mailing/send';

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : []);

/** A new digest's design: what's new on the site, and the events coming up. */
const STARTER = (events: boolean) => ({
  root: { props: { preheader: 'What’s new this week' } },
  content: [
    { type: 'Heading', props: { id: 'Heading-digest', text: '{site_name}: this week', level: 1, align: 'left' } },
    { type: 'Text', props: { id: 'Text-digest', html: '<p>Hi {first_name|there}, here’s what’s new.</p>', align: 'left' } },
    { type: 'Entries', props: { id: 'Entries-digest', heading: 'New this week', query: { count: 5, newOnly: true }, showImage: true, showExcerpt: true, linkLabel: 'Read more', empty: '' } },
    ...(events ? [{ type: 'Events', props: { id: 'Events-digest', heading: 'Coming up', query: { source: 'upcoming', count: 5 }, showImage: true, showVenue: true, showExcerpt: false, linkLabel: 'Details', empty: '' } }] : []),
  ],
});

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const isForm = /form/.test(request.headers.get('content-type') ?? '');
  const body: any = isForm ? Object.fromEntries((await request.formData()).entries()) : await request.json().catch(() => ({}));
  const action = String(body.action ?? '');
  const db = locals.db;
  const admin = locals.user?.role === 'admin';
  const fail = (msg: string, status = 400) => new Response(msg, { status });
  const { data: siteRow } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
  const settings = mailingSettings(siteRow?.value);

  if (action === 'create') {
    const { data: lists } = await db.from('mail_lists').select('id').order('sort').limit(1);
    const { data, error } = await db.from('digests').insert({ name: 'Weekly digest', subject: '{site_name}: the week of {week_of}', design: STARTER(siteRow?.value?.events?.enabled === true), list_ids: lists?.length ? [lists[0].id] : [], track_links: settings.trackLinks !== false, utm: true }).select('id').single();
    if (error) return fail(error.message);
    return isForm ? redirect(`/admin/mailing/digests/${data.id}/`, 303) : Response.json({ id: data.id });
  }
  const id = Number(body.id);
  const { data: d } = await db.from('digests').select('*').eq('id', id).maybeSingle<Digest>();
  if (!d) return fail('No such digest.', 404);

  switch (action) {
    case 'save': {
      const f = body.digest ?? {};
      const enabled = !!f.enabled;
      if ((enabled || d.enabled) && !admin) return fail('Only admins turn a digest on, or change one that is on.', 403);
      if (enabled && !settings.address) return fail('Add the postal address under Settings > Mailing first: every email must carry it.');
      const patch = {
        name: text(f.name, 200) || 'Weekly digest',
        subject: text(f.subject, 300),
        from_name: text(f.from_name, 100),
        reply_to: EMAIL_RE.test(text(f.reply_to, 254)) ? text(f.reply_to, 254) : '',
        design: f.design && typeof f.design === 'object' ? f.design : d.design,
        text: text(f.text, 100_000),
        list_ids: ids(f.list_ids),
        audience: audienceOf(f.audience),
        weekday: Math.min(6, Math.max(0, Math.round(Number(f.weekday)) || 0)),
        send_time: /^\d{2}:\d{2}$/.test(String(f.send_time)) ? f.send_time : '09:00',
        mode: f.mode === 'auto' ? 'auto' : 'review',
        review_hours: Math.min(168, Math.max(1, Math.round(Number(f.review_hours)) || 24)),
        skip_when_empty: f.skip_when_empty !== false,
        min_items: Math.max(0, Math.round(Number(f.min_items)) || 1),
        track_links: f.track_links !== false,
        utm: !!f.utm,
        enabled,
      };
      if (enabled && !patch.list_ids.length) return fail('Choose at least one list before turning it on.');
      const { data, error } = await db.from('digests').update(patch).eq('id', id).select('updated_at').single();
      return error ? fail(error.message) : Response.json({ ok: true, updated_at: data.updated_at });
    }
    case 'test': {
      // This week's issue as it would be now: new entries since the last issue that went out.
      const { data: last } = await db.from('campaigns').select('sent_at').eq('digest_id', id).eq('status', 'sent').order('sent_at', { ascending: false }).limit(1);
      const since = last?.[0]?.sent_at ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
      const week = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      const issue = { id: 0, name: d.name, subject: (d.subject || d.name).replace(/\{week_of\}/g, week).replace(/\{date\}/g, week), from_name: d.from_name, reply_to: d.reply_to, design: d.design, text: d.text, since, list_ids: d.list_ids, audience: d.audience } as unknown as Campaign;
      try {
        await sendTest(serviceClient(), issue, [{ email: locals.user!.email, name: locals.user!.name || '' }]);
      } catch (e) {
        return fail((e as Error).message);
      }
      return Response.json({ ok: true, sent: [locals.user!.email] });
    }
    case 'issue': {
      if (!admin) return fail('Admins only', 403);
      if (!settings.address) return fail('Add the postal address under Settings > Mailing first.');
      const out = await runDigest(serviceClient(), d, new Date(), { force: true });
      return out.startsWith('failed') ? fail(out) : Response.json({ ok: true, result: out });
    }
    case 'delete': {
      if (!admin) return fail('Admins only', 403);
      const { error } = await db.from('digests').delete().eq('id', id);
      return error ? fail(error.message) : Response.json({ ok: true });
    }
  }
  return fail('Unknown action.');
};
