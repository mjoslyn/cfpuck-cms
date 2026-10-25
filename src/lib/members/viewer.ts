// Who is viewing (server only): the signed-in person from the session cookie, their profile and their
// membership. Asked only when a page depends on it (src/pages/[...path].ts), and only of visitors with a
// session cookie, so most requests never look a session up (src/lib/auth). The profile and membership
// are read as the server.
import type { AstroCookies } from 'astro';
import { siteDb } from '../supabase';
import { hasSession, sessionUser } from '../auth';
import type { MemberRow, Viewer } from './config';

export { hasSession };

/** The signed-in viewer, or null for visitors who aren't signed in. */
export async function viewerOf(request: Request, _cookies?: AstroCookies): Promise<Viewer | null> {
  const user = await sessionUser(request);
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
