// Whether the visitor is signed in, for the Member link on cached pages (public/assets/js/member-link.js).
import type { APIRoute } from 'astro';
import { viewerOf } from '../../../lib/members/viewer';
import { isActive } from '../../../lib/members/config';

export const GET: APIRoute = async ({ request, cookies }) => {
  const v = await viewerOf(request, cookies);
  return Response.json(v ? { signedIn: true, name: v.name || v.email, member: isActive(v.member) } : { signedIn: false }, { headers: { 'Cache-Control': 'private, no-store' } });
};
