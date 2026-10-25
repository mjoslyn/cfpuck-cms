// Members (an optional feature, on under Settings > Members): the settings, who is viewing a page, what
// they may see and what a ticket costs them. Safe in the browser; members-only entries are left out by
// the site's loader (visibleTo in src/lib/data.ts).

/** A membership level (settings.site.members.levels). */
export interface MemberLevel {
  id: string;
  name: string;
}

/** settings.site.members. */
export interface MemberSettings {
  enabled?: boolean;
  levels: MemberLevel[];
  /** off: only admins add members; approve: visitors sign up and wait for an admin; open: they're members at once. */
  signup: 'off' | 'approve' | 'open';
  /** The level sign-ups get. */
  signupLevel?: string;
  /** Shown on members-only pages and blocks to visitors who can't see them (default MEMBERS_MESSAGE). */
  message?: string;
}

export const MEMBERS_MESSAGE = 'This is for members.';
/** The account page: signing in and up, the member's details. A page with this address takes its place (with a Member account block on it). */
export const ACCOUNT_PATH = '/account/';

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const levelId = (v: unknown) => str(v, 40).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');

/** The member settings as stored, cleaned up. */
export function memberSettings(site: Record<string, any> | null | undefined): MemberSettings {
  const m = site?.members ?? {};
  const levels: MemberLevel[] = [];
  for (const l of Array.isArray(m.levels) ? m.levels : []) {
    const id = levelId(l?.id) || levelId(l?.name);
    if (id && !levels.some((x) => x.id === id)) levels.push({ id, name: str(l?.name, 100) || id });
  }
  const signup = ['approve', 'open'].includes(m.signup) ? m.signup : 'off';
  return {
    enabled: m.enabled === true,
    levels,
    signup,
    signupLevel: levels.some((l) => l.id === m.signupLevel) ? m.signupLevel : levels[0]?.id,
    message: str(m.message, 1000) || undefined,
  };
}

/** What the settings API stores (undefined: nothing set). */
export function memberSettingsFrom(v: unknown): MemberSettings | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const s = memberSettings({ members: v });
  return s.enabled || s.levels.length ? s : undefined;
}

/** A member's row (table members). */
export interface MemberRow {
  user_id: string;
  email: string;
  name: string;
  level: string;
  status: 'pending' | 'active' | 'suspended';
  expires_on: string | null;
  notes?: string;
  created_at?: string;
}

/** Who is viewing a page: a signed-in person, and their membership if they have one. */
export interface Viewer {
  id: string;
  email: string;
  name: string;
  /** An editor or admin: sees members-only pages and blocks (not member prices). */
  editor: boolean;
  member: MemberRow | null;
}

/** Today in UTC ("Y-m-d"), as the database compares expiry dates. */
const today = () => new Date().toISOString().slice(0, 10);

/** Whether a membership counts now: active and not past its expiry. */
export const isActive = (m: MemberRow | null | undefined): m is MemberRow => !!m && m.status === 'active' && (!m.expires_on || m.expires_on >= today());

/** Who may see an entry (fields.access): members (of some levels; none: any level). */
export interface Access {
  members: boolean;
  levels: string[];
}

export function accessOf(fields: Record<string, any> | null | undefined): Access {
  const a = fields?.access;
  return { members: a?.members === true, levels: Array.isArray(a?.levels) ? a.levels.filter((l: unknown) => typeof l === 'string' && l) : [] };
}

/** Whether a viewer's membership is one of some levels (none: any), as member_can in the database. */
export const memberOf = (viewer: Viewer | null | undefined, levels: string[] = []) => isActive(viewer?.member) && (!levels.length || levels.includes(viewer!.member!.level));

/** Whether a viewer may see something limited to members of some levels (editors may). */
export const mayView = (viewer: Viewer | null | undefined, levels: string[] = []) => !!viewer?.editor || memberOf(viewer, levels);

/** The names of some levels ("Business or Patron"), for messages. */
export function levelNames(settings: MemberSettings, levels: string[]): string {
  const names = levels.map((id) => settings.levels.find((l) => l.id === id)?.name ?? id);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : (names[0] ?? '');
}
