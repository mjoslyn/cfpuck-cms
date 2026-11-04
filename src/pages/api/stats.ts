// A page view or link click reported by public/assets/js/stats.js (src/lib/stats.ts). The body is JSON
// sent as text (navigator.sendBeacon). Signed-in editors aren't counted; the answer is always 204.
import type { APIRoute } from 'astro';
import { siteDb } from '../../lib/db/site';
import { recordHit } from '../../lib/stats';
import { hasSession, viewerOf } from '../../lib/members/viewer';

export const POST: APIRoute = async ({ request }) => {
  const done = new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  const text = (await request.text()).slice(0, 2000);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return done;
  }
  if (hasSession(request) && (await viewerOf(request).catch(() => null))?.editor) return done;
  await recordHit(siteDb(), body, request).catch((e) => console.error(`stats: ${(e as Error).message}`));
  return done;
};
