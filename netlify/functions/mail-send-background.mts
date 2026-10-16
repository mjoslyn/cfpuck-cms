// The mailing worker: one sending run of a campaign (src/lib/mailing/send.ts runCampaign). A function whose
// name ends in -background answers 202 at once and runs for up to 15 minutes, past what a request may.
// It sends only the campaign it was given, and only with the claim token the sender wrote to the campaign's
// row, so a stray request does nothing. Under astro dev the same code runs in-process.
import { runCampaign } from '../../src/lib/mailing/send';

export default async (req: Request) => {
  let body: { campaignId?: number; token?: string } = {};
  try {
    body = await req.json();
  } catch {}
  if (!body.campaignId || !body.token) return new Response('bad request', { status: 400 });
  await runCampaign(Number(body.campaignId), String(body.token));
  return new Response('ok');
};
