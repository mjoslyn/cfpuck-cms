// Campaigns (the Mailing Lists screen and the campaign editor). JSON posts { action, id, ... }:
// create (a draft; a form post from the list goes to its editor), save, test (to the signed-in editor,
// and up to 5 more addresses), count (who it would go to now), duplicate, delete (drafts and campaigns
// that sent nothing). Admins only: schedule (at: local "Y-m-dTH:i"), send (now), pause, resume, cancel,
// approve (a digest's issue waiting for review), reconcile (Mailgun's totals), unpause (sending site-wide).
// Writes here don't change the site's pages (src/lib/cache.ts).
import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../lib/supabase';
import { SITE_TZ } from '../../../../lib/site';
import { localToUtc } from '../../../../lib/recurrence';
import { EMAIL_RE, audienceOf, mailingSettings, splitName, type Campaign } from '../../../../lib/mailing/config';
import { audience, sendTest, startSending } from '../../../../lib/mailing/send';
import { mailgunStatus, tagStats } from '../../../../lib/mailing/mailgun';
import { setPaused } from '../../../../lib/mailing/state';

const SENDABLE = ['draft', 'review', 'paused', 'failed'];
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : []);

/** A new campaign's starting design: a heading, a greeting and a button. */
export const STARTER_DESIGN = {
  root: { props: {} },
  content: [
    { type: 'Heading', props: { id: 'Heading-start', text: 'News from {site_name}', level: 1, align: 'left' } },
    { type: 'Text', props: { id: 'Text-start', html: '<p>Hi {first_name|there},</p><p>Write your news here.</p>', align: 'left' } },
    { type: 'Button', props: { id: 'Button-start', label: 'Read more', url: '/', align: 'left' } },
  ],
};

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
    const { data, error } = await db.from('campaigns').insert({ name: 'New campaign', subject: '', design: STARTER_DESIGN, list_ids: lists?.length ? [lists[0].id] : [], track_links: settings.trackLinks !== false, utm: !!settings.utm, created_by: locals.user!.id }).select('id').single();
    if (error) return fail(error.message);
    return isForm ? redirect(`/admin/mailing-lists/campaigns/${data.id}/`, 303) : Response.json({ id: data.id });
  }
  if (action === 'unpause') {
    if (!admin) return fail('Admins only', 403);
    await setPaused(serviceClient(), null);
    return isForm ? redirect('/admin/mailing-lists/?ok=Sending%20resumed.', 303) : Response.json({ ok: true });
  }

  const id = Number(body.id);
  const { data: c } = await db.from('campaigns').select('*').eq('id', id).maybeSingle<Campaign>();
  if (!c) return fail('No such campaign.', 404);
  /** A segment that exists, else none. */
  async function segmentId(v: unknown): Promise<number | null> {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) return null;
    const { data } = await db.from('mail_segments').select('id').eq('id', n).maybeSingle();
    return data ? n : null;
  }
  const adminOnly = () => (admin ? null : fail('Only admins send, schedule and change campaigns that are sending.', 403));

  switch (action) {
    case 'save': {
      if (!SENDABLE.includes(c.status) && c.status !== 'scheduled') return fail('A campaign can’t be changed once it is sending.');
      if (c.status !== 'draft' && !admin) return fail('Only admins change scheduled or waiting campaigns.', 403);
      const f = body.campaign ?? {};
      const patch = {
        name: text(f.name, 200),
        subject: text(f.subject, 300),
        from_name: text(f.from_name, 100),
        reply_to: EMAIL_RE.test(text(f.reply_to, 254)) ? text(f.reply_to, 254) : '',
        design: f.design && typeof f.design === 'object' ? f.design : c.design,
        text: text(f.text, 100_000),
        list_ids: ids(f.list_ids),
        audience: audienceOf(f.audience),
        segment_id: await segmentId(f.segment_id),
        track_links: f.track_links !== false,
        utm: !!f.utm,
      };
      const { data, error } = await db.from('campaigns').update(patch).eq('id', id).select('updated_at').single();
      return error ? fail(error.message) : Response.json({ ok: true, updated_at: data.updated_at });
    }
    case 'count': {
      const people = await audience(serviceClient(), c);
      return Response.json({ count: people.length });
    }
    case 'test': {
      const extra = (Array.isArray(body.to) ? body.to : String(body.to ?? '').split(/[\s,;]+/)).map((e: string) => String(e).trim().toLowerCase()).filter((e: string) => EMAIL_RE.test(e)).slice(0, 5);
      const to = [{ email: locals.user!.email, ...splitName(locals.user!.name) }, ...extra.filter((e: string) => e !== locals.user!.email).map((email: string) => ({ email }))];
      try {
        await sendTest(serviceClient(), c, to);
      } catch (e) {
        return fail((e as Error).message);
      }
      return Response.json({ ok: true, sent: to.map((t) => t.email), mailgun: mailgunStatus().configured });
    }
    case 'duplicate': {
      const { data, error } = await db.from('campaigns').insert({ name: `${c.name} (copy)`, subject: c.subject, from_name: c.from_name, reply_to: c.reply_to, design: c.design, text: c.text, list_ids: c.list_ids, audience: c.audience, segment_id: c.segment_id, track_links: c.track_links, utm: c.utm, created_by: locals.user!.id }).select('id').single();
      return error ? fail(error.message) : Response.json({ id: data.id });
    }
    case 'delete': {
      if (!['draft', 'cancelled', 'skipped', 'failed'].includes(c.status) || c.started_at) return fail('Only drafts, and campaigns that sent nothing, can be deleted.');
      if (c.status !== 'draft' && !admin) return fail('Admins only', 403);
      const { error } = await db.from('campaigns').delete().eq('id', id);
      return error ? fail(error.message) : Response.json({ ok: true });
    }
  }

  const denied = adminOnly();
  if (denied) return denied;
  const svc = serviceClient();
  const ready = () => {
    if (!c.subject.trim()) return 'Give it a subject.';
    if (!c.list_ids?.length) return 'Choose at least one list.';
    if (!settings.address) return 'Add the postal address under Settings > Mailing Lists: every email must carry it.';
    return '';
  };
  switch (action) {
    case 'schedule':
    case 'send': {
      if (!SENDABLE.includes(c.status) && c.status !== 'scheduled') return fail('This campaign has already gone out.');
      if (c.started_at && c.status !== 'paused' && c.status !== 'failed') return fail('This campaign has already started sending.');
      const problem = ready();
      if (problem) return fail(problem);
      let at = new Date().toISOString();
      if (action === 'schedule') {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(body.at ?? ''))) return fail('Choose a date and time.');
        at = localToUtc(`${String(body.at).replace('T', ' ')}:00`, SITE_TZ);
        if (Date.parse(at) < Date.now() - 60_000) return fail('That time has passed.');
      }
      const { error } = await svc.from('campaigns').update({ status: 'scheduled', scheduled_at: at, sent_by: locals.user!.id, error: '', ...(c.status === 'review' ? { approved_by: locals.user!.id, approved_at: new Date().toISOString() } : {}) }).eq('id', id);
      if (error) return fail(error.message);
      if (action === 'send') await startSending(id, new URL(request.url).origin);
      return Response.json({ ok: true, scheduled_at: at });
    }
    case 'approve': {
      if (c.status !== 'review') return fail('This issue isn’t waiting for approval.');
      const problem = ready();
      if (problem) return fail(problem);
      const { error } = await svc.from('campaigns').update({ status: 'scheduled', approved_by: locals.user!.id, approved_at: new Date().toISOString() }).eq('id', id);
      return error ? fail(error.message) : Response.json({ ok: true });
    }
    case 'unschedule': {
      if (c.status !== 'scheduled' || c.started_at) return fail('Only a scheduled campaign that hasn’t started can go back to a draft.');
      const { error } = await svc.from('campaigns').update({ status: c.digest_id && !c.approved_at ? 'review' : 'draft', scheduled_at: c.digest_id ? c.scheduled_at : null }).eq('id', id);
      return error ? fail(error.message) : Response.json({ ok: true });
    }
    case 'pause': {
      if (!['sending', 'scheduled'].includes(c.status)) return fail('Only a campaign that is sending or scheduled can be paused.');
      const { error } = await svc.from('campaigns').update({ status: 'paused' }).eq('id', id);
      return error ? fail(error.message) : Response.json({ ok: true });
    }
    case 'resume': {
      if (!['paused', 'failed'].includes(c.status)) return fail('Only a paused or failed campaign can be resumed.');
      const { error } = await svc.from('campaigns').update({ status: 'scheduled', scheduled_at: c.scheduled_at && Date.parse(c.scheduled_at) > Date.now() ? c.scheduled_at : new Date().toISOString(), error: '' }).eq('id', id);
      if (error) return fail(error.message);
      if (!c.scheduled_at || Date.parse(c.scheduled_at) <= Date.now()) await startSending(id, new URL(request.url).origin);
      return Response.json({ ok: true });
    }
    case 'cancel': {
      if (['sent', 'cancelled'].includes(c.status)) return fail('Already finished.');
      const { error } = await svc.from('campaigns').update({ status: 'cancelled' }).eq('id', id);
      return error ? fail(error.message) : Response.json({ ok: true });
    }
    case 'reconcile': {
      try {
        return Response.json({ totals: await tagStats(`campaign-${id}`) });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  }
  return fail('Unknown action.');
};
