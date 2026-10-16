// Unsubscribing: the one-click POST mail apps send from the List-Unsubscribe header (RFC 8058; its body is
// "List-Unsubscribe=One-Click", from the mail provider's servers, so the middleware's same-site check
// lets this route through), and the button on the unsubscribe page. t: the signed manage token; c: the
// campaign the email was; l: one list only. Takes effect at once.
import type { APIRoute } from 'astro';
import { serviceClient } from '../../../lib/supabase';
import { PREFERENCES_PATH, UNSUBSCRIBE_PATH } from '../../../lib/mailing/config';
import { unsubscribe } from '../../../lib/mailing/contacts';
import { verify } from '../../../lib/mailing/tokens';
import { safeNext } from '../../../lib/members/account';

export const POST: APIRoute = async ({ request, url, redirect }) => {
  const type = request.headers.get('content-type') ?? '';
  const form = /multipart\/form-data|application\/x-www-form-urlencoded/i.test(type) ? await request.formData() : new FormData();
  const field = (k: string) => String(form.get(k) ?? url.searchParams.get(k) ?? '');
  const oneClick = form.get('List-Unsubscribe') === 'One-Click';
  const token = field('t');
  const id = verify('manage', token);
  const campaign = /^\d+$/.test(field('c')) ? Number(field('c')) : undefined;
  const list = /^\d+$/.test(field('l')) ? Number(field('l')) : undefined;
  const done = id ? await unsubscribe(serviceClient(), id, { list, campaign }) : false;
  if (oneClick) return new Response(done ? 'Unsubscribed.' : 'Not found.', { status: done ? 200 : 404, headers: { 'Cache-Control': 'no-store' } });
  const back = safeNext(form.get('back')) || UNSUBSCRIBE_PATH;
  if (!id) return redirect(`${back}?error=${encodeURIComponent('That link isn’t valid. Use the link in one of our emails.')}`, 303);
  return redirect(`${list ? PREFERENCES_PATH : back}?t=${encodeURIComponent(token)}&m=${list ? 'unsubscribed-list' : 'unsubscribed'}`, 303);
};

/** A mail app that opens the header's address instead of posting to it: the unsubscribe page, which asks first. */
export const GET: APIRoute = ({ url, redirect }) => {
  const q = new URLSearchParams();
  for (const k of ['t', 'c', 'l']) if (url.searchParams.get(k)) q.set(k, url.searchParams.get(k)!);
  return redirect(`${UNSUBSCRIBE_PATH}?${q}`, 303);
};
