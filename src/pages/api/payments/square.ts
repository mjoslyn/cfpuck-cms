// Square's webhook for form payments (src/lib/forms/checkout.ts). In the Square Developer Dashboard, a
// subscription to payment.created and payment.updated at <site>/api/payments/square; its signature key
// is SQUARE_WEBHOOK_SIGNATURE_KEY and SQUARE_WEBHOOK_URL is that exact address (the signature covers
// it). An event only says which order to look at: its state is asked of Square.
import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/supabase';
import { confirmPayment, submissionByRef } from '../../../lib/forms/checkout';
import { verifySquareSignature } from '../../../lib/payments/square';
import { env } from '../../../lib/payments/common';

export const POST: APIRoute = async ({ request }) => {
  const key = env('SQUARE_WEBHOOK_SIGNATURE_KEY');
  if (!key) return new Response('Square webhooks are not set up (SQUARE_WEBHOOK_SIGNATURE_KEY).', { status: 503 });
  const body = await request.text();
  const url = env('SQUARE_WEBHOOK_URL') || request.url;
  if (!(await verifySquareSignature(body, request.headers.get('x-square-hmacsha256-signature') ?? '', url, key))) return new Response('Bad signature', { status: 400 });
  const event = JSON.parse(body);
  const orderId = event?.data?.object?.payment?.order_id;
  if (!String(event?.type ?? '').startsWith('payment.') || !orderId) return Response.json({ ignored: true });
  const db = serviceClient();
  const sub = await submissionByRef(db, String(orderId));
  if (!sub) return Response.json({ ignored: true });
  await confirmPayment(db, sub);
  return Response.json({ ok: true });
};
