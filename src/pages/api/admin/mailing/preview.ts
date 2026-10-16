// The email builder's previews for mailing emails. POST { query, since? }: an Entries block's entries as
// they are now (the canvas). POST { design, text, subject, since? }: the whole email as it would be sent
// to a sample subscriber (the Preview tab), rendered by the code that sends it. Read-only.
import type { APIRoute } from 'astro';
import { emailEvents } from '../../../../lib/events/email';
import { emailEntries } from '../../../../lib/mailing/entries';
import { loadMailing, mailOrigin } from '../../../../lib/mailing/contacts';
import { recipientValues, renderCampaign } from '../../../../lib/mailing/render';

const fill = (s: string, v: Record<string, string>) => s.replace(/%recipient\.([a-z0-9_]+)%/gi, (_, k) => v[k] ?? '');

export const POST: APIRoute = async ({ request, locals }) => {
  const body = await request.json().catch(() => ({}));
  const origin = mailOrigin(new URL(request.url).origin);
  const since = typeof body.since === 'string' ? body.since : new Date(Date.now() - 7 * 86_400_000).toISOString();
  try {
    if (body.query) {
      const out = await emailEntries(locals.db, { root: { props: {} }, content: [{ type: 'Entries', props: { id: 'q', query: body.query } }] }, origin, since);
      return Response.json(out.q ?? []);
    }
    const design = body.design?.content ? body.design : { root: { props: {} }, content: [] };
    const { name, settings } = await loadMailing(locals.db);
    const [events, entries] = await Promise.all([emailEvents(locals.db, design, origin), emailEntries(locals.db, design, origin, since)]);
    const week = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const subject = String(body.subject ?? '').replace(/\{week_of\}/g, week).replace(/\{date\}/g, week);
    const r = renderCampaign({ campaignId: Number(body.id) || 0, subject, design, text: String(body.text ?? ''), siteName: name, address: settings.address ?? '(your postal address, from Settings > Mailing Lists)', origin, events, entries });
    const values = recipientValues(r.vars, { email: 'sam@example.com', name: 'Sam Sample' }, { t: 'sample', ct: 'sample' });
    return Response.json({ to: ['Sam Sample <sam@example.com>'], replyTo: settings.replyTo, subject: fill(r.subject, values), html: fill(r.html, values), text: fill(r.text, values) });
  } catch (e) {
    return new Response((e as Error).message, { status: 400 });
  }
};
