// Email a member a link to set a new password (to the account page, an hour, once). The answer is the
// same whether or not the address has an account, and over the limits (3 an hour per address, 20 per
// visitor), when none is sent; without SMTP the link is only logged on the server.
import type { APIRoute } from 'astro';
import { passwordToken, userByEmail } from '../../../lib/auth';
import { mayAskLink } from '../../../lib/auth/attempts';
import { passwordEmail, sendLink } from '../../../lib/auth/mail';
import { passwordPage } from '../../../lib/admin/invite';
import { accountUrl } from '../../../lib/members/account';

export const POST: APIRoute = async ({ request, redirect, url }) => {
  const email = String((await request.formData()).get('email') ?? '');
  const user = (await mayAskLink(email, request)) ? await userByEmail(email) : null;
  if (user) {
    const link = `${url.origin}${passwordPage('member', await passwordToken(user.id))}`;
    if ((await sendLink(passwordEmail(user.email, link)).catch((e: Error) => (console.error(`[auth] password email failed: ${e.message}`), 'no-smtp' as const))) === 'no-smtp') console.warn(`[auth] password link for ${user.email}: ${link}`);
  }
  return redirect(accountUrl({ m: 'sent' }), 303);
};
