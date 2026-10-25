// A tracked link in a mailing email: the click is recorded and judged (src/lib/mailing/tracking.ts),
// then the visitor goes on to the link's address, which comes from its stored row. HEAD answers the same
// redirect and counts as a machine's. Never cached.
import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../lib/db/site';
import { recordClick } from '../../../../lib/mailing/tracking';
import { clientCountry, clientIp } from '../../../../lib/mailing/request';

const go = async (params: Record<string, string | undefined>, request: Request) => {
  const linkId = Number(params.link);
  if (!Number.isInteger(linkId) || linkId <= 0) return new Response('Not found', { status: 404 });
  const to = await recordClick(serviceClient(), { linkId, ct: String(params.ct ?? ''), method: request.method, userAgent: request.headers.get('user-agent') ?? '', ip: clientIp(request), country: clientCountry(request) }).catch((e) => {
    console.error(`mailing: click failed: ${e.message}`);
    return null;
  });
  if (!to) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return new Response(null, { status: 302, headers: { Location: to, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer-when-downgrade', 'X-Robots-Tag': 'noindex' } });
};

export const GET: APIRoute = ({ params, request }) => go(params, request);
export const HEAD: APIRoute = ({ params, request }) => go(params, request);
