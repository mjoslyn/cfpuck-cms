// Mailgun's webhooks for the marketing domain (Sending > Webhooks: delivered, opened, permanent and
// temporary failure, spam complaint, unsubscribed, all to <site>/api/mailgun/webhook). The signature is
// checked with MAILGUN_WEBHOOK_SIGNING_KEY; the work is src/lib/mailing/webhook.ts. A failure answers
// 500, so Mailgun tries again; a bad signature answers 406, so it doesn't.
import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/supabase';
import { handleWebhook } from '../../../lib/mailing/webhook';

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body) return new Response('Bad request', { status: 400 });
  try {
    const { status, body: text } = await handleWebhook(serviceClient(), body);
    return new Response(text, { status });
  } catch (e) {
    console.error(`mailgun webhook: ${(e as Error).message}`);
    return new Response('Failed', { status: 500 });
  }
};
