// Who is viewing (server only): the signed-in person from the session cookie, their profile and their
// membership. Asked only when a page depends on it (src/pages/[...path].ts), and only of visitors with a
// sign-in cookie, so most requests never reach Supabase Auth. The session is checked with Supabase Auth;
// the profile and membership are read with the site's key, since the database API is closed to
// everyone but editors.
import type { AstroCookies } from 'astro';
import { authClient, siteDb } from '../supabase';
import type { MemberRow, Viewer } from './config';

/** Whether a request carries a Supabase sign-in cookie. */
export const hasSession = (request: Request) => /(^|;\s*)sb-[^=]*-auth-token/.test(request.headers.get('cookie') ?? '');

/** The signed-in viewer, or null for visitors who aren't signed in. */
export async function viewerOf(request: Request, cookies: AstroCookies): Promise<Viewer | null> {
  if (!hasSession(request)) return null;
  const {
    data: { user },
  } = await authClient(request, cookies).auth.getUser();
  if (!user) return null;
  const db = siteDb();
  const [{ data: profile }, { data: member }] = await Promise.all([
    db.from('profiles').select('role, display_name').eq('id', user.id).maybeSingle(),
    db.from('members').select('*').eq('user_id', user.id).maybeSingle(),
  ]);
  return {
    id: user.id,
    email: user.email ?? '',
    name: (member as MemberRow | null)?.name || profile?.display_name || '',
    editor: ['editor', 'admin'].includes(profile?.role ?? ''),
    member: (member as MemberRow | null) ?? null,
  };
}
