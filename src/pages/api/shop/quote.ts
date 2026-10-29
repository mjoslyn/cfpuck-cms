// The cart priced now, for the cart's script (public/assets/js/cart.js): POST { lines: [{ product,
// variant, quantity }] } -> { lines, count, subtotal, currency } (src/lib/shop/cart.ts). As the visitor
// sees the site: members-only products for their members. Not found while the shop is off.
import type { APIRoute } from 'astro';
import { siteDb } from '../../../lib/db/site';
import { siteViewer } from '../../../lib/members/viewer';
import { featuresOf, offTypes } from '../../../lib/features';
import { shopOn } from '../../../lib/shop/config';
import { quoteCart } from '../../../lib/shop/cart';

export const POST: APIRoute = async ({ request }) => {
  const db = siteDb();
  const { data: siteRow } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
  if (!shopOn(siteRow?.value)) return new Response('Not found', { status: 404 });
  const body = await request.json().catch(() => ({}));
  const viewer = await siteViewer(request);
  const quote = await quoteCart(db, body?.lines, { published: true, viewer, off: offTypes(featuresOf(siteRow?.value)) }, siteRow?.value);
  return Response.json(quote, { headers: { 'Cache-Control': 'private, no-store' } });
};
