import type { APIRoute } from 'astro';
import { passwordToken, userByEmail } from '../../../lib/auth';
import { passwordEmail, sendLink } from '../../../lib/auth/mail';
import { passwordPage } from '../../../lib/admin/invite';

/**
 * Email a password link to /admin/set-password/ (an hour, once). The answer is the same whether or not
 * the address has an account; without SMTP the link is only logged on the server.
 */
export const POST: APIRoute = async ({ request, redirect, url }) => {
  const form = await request.formData();
  const user = await userByEmail(String(form.get('email') ?? ''));
  if (user) {
    const link = `${url.origin}${passwordPage('admin', await passwordToken(user.id))}`;
    if ((await sendLink(passwordEmail(user.email, link)).catch(() => 'no-smtp')) === 'no-smtp') console.warn(`[auth] password link for ${user.email}: ${link}`);
  }
  return redirect('/admin/login/?sent=1');
};
