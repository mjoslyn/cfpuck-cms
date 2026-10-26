// The Email preferences block's data (server only; registered with the page renderer's hooks when the
// middleware loads this module): whose subscription the page is for, from its signed link (?t= to
// manage, ?confirm= to confirm a sign-up) or the signed-in visitor's address, and that contact's lists.
import { renderHooks } from '../../render/hooks';
import type { RenderCtx } from '../../render/env';
import type { Contact } from './config';
import { verify, sign } from './tokens';
import { PREFS_KEY } from '../../render/c/mailing';

/** What the Email preferences block shows. */
export interface PrefsData {
  /** confirm: a sign-up's confirmation link; manage: a signed link from an email; viewer: the signed-in visitor; none. */
  mode: 'confirm' | 'manage' | 'viewer' | 'none';
  contact: Contact | null;
  /** The contact's lists' statuses, by list id. */
  lists: Record<number, string>;
  /** The token the page's forms post back (manage, or confirm). */
  token: string;
  /** For a confirmation page: the manage token, to show preferences after. */
  manage?: string;
}

async function preparePreferences(ctx: RenderCtx): Promise<void> {
  if (ctx.data.has(PREFS_KEY)) return;
  const q = ctx.queried.url.searchParams;
  const db = ctx.loader.db;
  const out: PrefsData = { mode: 'none', contact: null, lists: {}, token: '' };
  const load = async (id: number) => {
    const [{ data: c }, { data: rows }] = await Promise.all([db.from('contacts').select('*').eq('id', id).maybeSingle(), db.from('contact_lists').select('list_id, status').eq('contact_id', id)]);
    out.contact = (c as Contact | null) ?? null;
    out.lists = Object.fromEntries((rows ?? []).map((r) => [Number(r.list_id), String(r.status)]));
  };
  const confirmId = verify('confirm', q.get('confirm'));
  const manageId = verify('manage', q.get('t'));
  if (confirmId) {
    await load(confirmId);
    if (out.contact) Object.assign(out, { mode: 'confirm', token: q.get('confirm')!, manage: sign('manage', confirmId) });
  } else if (manageId) {
    await load(manageId);
    if (out.contact) Object.assign(out, { mode: 'manage', token: q.get('t')! });
  } else if (ctx.viewer?.email) {
    // Only an account whose address is confirmed sees that address's subscription; others can only sign up (confirmed by email).
    if (ctx.viewer.emailVerified) {
      const { data: c } = await db.from('contacts').select('id').eq('email', ctx.viewer.email.toLowerCase()).maybeSingle();
      if (c) await load(Number(c.id));
    }
    out.mode = 'viewer';
  }
  ctx.data.set(PREFS_KEY, out);
}

renderHooks.mailPreferences = preparePreferences;
