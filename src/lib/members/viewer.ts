// Who is viewing (server only): the signed-in person from the session cookie, their profile and their
// membership. Asked only when a page depends on it (src/pages/[...path].ts), and only of visitors with a
// sign-in cookie, so most requests never reach Supabase Auth.
import type { AstroCookies } from 'astro';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serverClient } from '../supabase';
import type { MemberRow, Viewer } from './config';

/** Whether a request carries a Supabase sign-in cookie. */
export const hasSession = (request: Request) => /(^|;\s*)sb-[^=]*-auth-token/.test(request.headers.get('cookie') ?? '');

/** The signed-in viewer and a database client acting as them, or null for visitors who aren't signed in. */
export async function viewerOf(request: Request, cookies: AstroCookies): Promise<{ db: SupabaseClient; viewer: Viewer } | null> {
  if (!hasSession(request)) return null;
  const db = serverClient(request, cookies);
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  const [{ data: profile }, { data: member }] = await Promise.all([
    db.from('profiles').select('role, display_name').eq('id', user.id).maybeSingle(),
    db.from('members').select('*').eq('user_id', user.id).maybeSingle(),
  ]);
  return {
    db,
    viewer: {
      id: user.id,
      email: user.email ?? '',
      name: (member as MemberRow | null)?.name || profile?.display_name || '',
      editor: ['editor', 'admin'].includes(profile?.role ?? ''),
      member: (member as MemberRow | null) ?? null,
    },
  };
}
