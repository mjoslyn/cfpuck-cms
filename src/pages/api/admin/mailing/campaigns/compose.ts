// Compose for a campaign (the campaign editor): POST { brief, campaign: { name, subject, design } } ->
// { name, subject, design, notes }. Nothing is saved: the editor reviews the email and saves it.
import type { APIRoute } from 'astro';
import { QuickError, quickAsk } from '../../../../../lib/compose/quick';
import { env } from '../../../../../lib/compose/client';
import { applyCampaign, campaignOutline, campaignSchema, campaignTask, type ComposedCampaign } from '../../../../../lib/mailing/compose';
import { LISTABLE_TYPES, typeDef } from '../../../../../lib/site';
import { eventsOn, showsType } from '../../../../../lib/events/on';
import { defaultTemplate } from '../../../../../lib/email-templates';

export const POST: APIRoute = async ({ request, locals }) => {
  const body = await request.json().catch(() => ({}));
  const brief = String(body.brief ?? '').slice(0, 8000).trim();
  const campaign = body.campaign ?? {};
  if (!brief) return new Response('Say what the email is about.', { status: 400 });
  const { data: siteRow } = await locals.db.from('settings').select('value').eq('key', 'site').maybeSingle();
  const events = eventsOn(siteRow?.value);
  const types = LISTABLE_TYPES.filter((t) => showsType(t, events)).map((t) => ({ type: t, label: typeDef(t)?.label ?? t }));
  try {
    const answer = await quickAsk<ComposedCampaign>(
      campaignTask(),
      { name: 'campaign', description: 'The campaign as asked.', input_schema: campaignSchema(types, events) },
      `${campaignOutline(campaign)}\n\nWhat the editor wants:\n${brief}`,
      12000,
      { model: env('ANTHROPIC_MODEL') || 'claude-sonnet-5-5', facts: 'Don\'t invent facts the editor didn\'t give (prices, dates, places, names).' },
    );
    const tpl = await defaultTemplate(locals.db, 'campaign').catch(() => null);
    const out = applyCampaign(answer, campaign.design, types.map((t) => t.type), tpl?.design?.root?.props ?? {});
    return Response.json(out);
  } catch (e) {
    return new Response((e as Error).message, { status: e instanceof QuickError ? e.status : 502 });
  }
};
