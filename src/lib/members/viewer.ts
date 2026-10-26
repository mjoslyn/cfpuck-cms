// Who is viewing (server only): the signed-in person from the session cookie, their profile and their
// membership. Asked only when a page depends on it (src/pages/[...path].ts), and only of visitors with a
// session cookie, so most requests never look a session up (src/lib/auth). The profile and membership
// are read as the server.
import type { AstroCookies } from 'astro';
import { siteDb } from '../db/site';
import { hasSession, sessionUser } from '../auth';
import { memberSettings, type MemberRow, type Viewer } from './config';

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
    emailVerified: user.emailVerified,
    name: (member as MemberRow | null)?.name || profile?.display_name || '',
    editor: ['editor', 'admin'].includes(profile?.role ?? ''),
    member: (member as MemberRow | null) ?? null,
  };
}

/**
 * The signed-in viewer as the site's pages see them (renderRequest): no membership while Members is off.
 * For endpoints that act on what a page shows (ticket checkout, waitlist, availability).
 */
export async function siteViewer(request: Request): Promise<Viewer | null> {
  const viewer = await viewerOf(request);
  if (!viewer?.member) return viewer;
  const { data } = await siteDb().from('settings').select('value').eq('key', 'site').maybeSingle();
  return memberSettings(data?.value).enabled ? viewer : { ...viewer, member: null };
}
