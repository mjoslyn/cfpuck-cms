// The members' account endpoints (src/pages/api/members/): shared checks and where each answer goes
// (back to the account page, with a message or an error). Server only.
import type { SupabaseClient } from '@supabase/supabase-js';
import { ACCOUNT_PATH, memberSettings, type MemberSettings } from './config';

/** The account page with a message (`m`), an error, or a page to go back to. */
export function accountUrl(q: { m?: string; error?: string; next?: string; view?: string } = {}): string {
  const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
  return `${ACCOUNT_PATH}${params.size ? `?${params}` : ''}`;
}

/** The member settings, read with any client (settings are public). */
export async function loadMemberSettings(db: SupabaseClient): Promise<MemberSettings> {
  const { data } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
  return memberSettings(data?.value);
}

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A path on this site to come back to ('' if none). */
export const safeNext = (v: unknown) => (typeof v === 'string' && /^\/(?![\/\\])[^\s\\]*$/.test(v) ? v.slice(0, 500) : '');
