// Confirming a new member's address (server only; account.ts is also read by the render code in the
// editor's browser bundle).
import { confirmToken } from '../auth';
import { confirmEmailMessage, sendLink } from '../auth/mail';
import { accountUrl } from './account';

/**
 * Email a new account the link confirming its address (the account page with `?confirm=`, which signs
 * them in and goes on to `next`). Without SMTP the link is only logged on the server.
 */
export async function sendConfirmation(email: string, origin: string, next = ''): Promise<void> {
  const link = `${origin}${accountUrl({ confirm: await confirmToken(email), next })}`;
  if ((await sendLink(confirmEmailMessage(email, link))) === 'no-smtp') console.warn(`[auth] confirmation link for ${email}: ${link}`);
}
