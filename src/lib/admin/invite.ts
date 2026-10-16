// Sending an invitation again (Users and Members screens), for an account that was invited and hasn't
// signed in yet. Supabase Auth re-sends an invitation to an address it hasn't confirmed, with a new link
// (the old one stops working). Server only: it uses the service key.
import { serviceClient } from '../supabase';

export async function resendInvite(id: string, redirectTo: string): Promise<{ email: string } | { error: string }> {
  if (!id) return { error: 'No account.' };
  const admin = serviceClient().auth.admin;
  const { data, error } = await admin.getUserById(id);
  if (error || !data.user?.email) return { error: error?.message ?? 'No such account.' };
  const user = data.user;
  if (user.last_sign_in_at || user.email_confirmed_at) return { error: `${user.email} has already accepted; send a password link instead.` };
  const { error: e2 } = await admin.inviteUserByEmail(user.email!, { redirectTo, data: user.user_metadata });
  return e2 ? { error: e2.message } : { email: user.email! };
}
