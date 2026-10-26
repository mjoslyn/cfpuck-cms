// Who may read and write each table, as the database's row security policies had it (the migrations
// up to *_awaiting_password.sql). The server's own role (`service`) isn't checked. Everyone else is a
// signed-in person: editors and admins get what the rules give them; anyone else (members, sign-ups,
// visitors) gets nothing. Reads a role may not make return no rows; refused inserts and writes whose
// rows fail a check are errors; updates and deletes reach only the rows the role may change.
import type { Filter } from './query';

export type Role = 'service' | 'admin' | 'editor' | 'none';

export interface Ctx {
  role: Role;
  /** The signed-in person (their auth user id). */
  uid?: string;
}

/** A write rule with conditions: the rows it reaches (`using`) and what the written rows must be (`check`). */
export interface Rule {
  using: (ctx: Ctx) => boolean | Filter;
  check: (ctx: Ctx, row: Record<string, any>) => boolean;
}

type Access = (ctx: Ctx) => boolean;
const editors: Access = (c) => c.role === 'editor' || c.role === 'admin';
const admins: Access = (c) => c.role === 'admin';
const nobody: Access = () => false;

interface TablePolicy {
  select: Access;
  insert: Access | Rule;
  update: Access | Rule;
  delete: Access | Rule;
}

const all = (read: Access, write: Access | Rule): TablePolicy => ({ select: read, insert: write, update: write, delete: write });
const readOnly = (read: Access): TablePolicy => all(read, nobody);

/** Admins change any row; editors only rows (as they are and as written) that `editorRow` allows. */
const adminsOrEditorsWhen = (filter: Filter, editorRow: (row: Record<string, any>) => boolean): Rule => ({
  using: (c) => (admins(c) ? true : editors(c) ? filter : false),
  check: (c, row) => admins(c) || (editors(c) && editorRow(row)),
});

export const POLICIES: Record<string, TablePolicy> = {
  campaign_batches: readOnly(editors),
  campaign_links: readOnly(editors),
  campaign_sends: readOnly(editors),
  link_clicks: readOnly(editors),
  mail_events: readOnly(editors),
  // Editors save campaigns only as drafts; sending, scheduling and approving are admins'.
  campaigns: all(editors, adminsOrEditorsWhen({ col: 'status', op: 'eq', value: 'draft' }, (r) => r.status === 'draft')),
  // Editors change a digest only while it is off.
  digests: all(editors, adminsOrEditorsWhen({ col: 'enabled', op: 'eq', value: false }, (r) => r.enabled === false)),
  compose_jobs: all(editors, editors),
  compose_sessions: all(editors, editors),
  email_templates: all(editors, editors),
  entries: all(editors, editors),
  entry_drafts: all(editors, editors),
  entry_terms: all(editors, editors),
  forms: all(editors, editors),
  mail_segments: all(editors, editors),
  media: all(editors, editors),
  revisions: all(editors, editors),
  templates: all(editors, editors),
  terms: all(editors, editors),
  ticket_emails: all(editors, editors),
  contact_lists: all(editors, admins),
  contacts: all(editors, admins),
  mail_lists: all(editors, admins),
  members: all(editors, admins),
  // Rules are admins' (Settings > Redirects); an entry's or term's moved address writes its own as the server.
  redirects: all(editors, admins),
  settings: all(editors, admins),
  form_submissions: { select: editors, insert: nobody, update: nobody, delete: editors },
  not_found: { select: editors, insert: nobody, update: nobody, delete: editors },
  // Orders and waitlists change through the attendee list's actions, which write as the server.
  ticket_orders: readOnly(editors),
  ticket_waitlist: readOnly(editors),
  mail_suppressions: readOnly(admins),
  // Admins change other people's profiles; editors rename themselves but don't change their own role.
  profiles: {
    select: editors,
    insert: nobody,
    update: {
      using: (c) => (admins(c) ? true : editors(c) ? { col: 'id', op: 'eq', value: c.uid ?? '' } : false),
      check: (c, row) => (admins(c) && row.id !== c.uid) || (editors(c) && row.id === c.uid && row.role === c.role),
    },
    delete: nobody,
  },
};

/**
 * What `ctx` may do with `table`: `true` (all rows), `false` (nothing), or for a read a filter on the
 * rows it sees, for a write (`write`) a Rule with conditions. Tables without policies are the server's.
 */
export function policyFor(table: string, op: 'select', ctx: Ctx): boolean | Filter;
export function policyFor(table: string, op: 'insert' | 'update' | 'delete', ctx: Ctx, write: true): boolean | Rule;
export function policyFor(table: string, op: 'select' | 'insert' | 'update' | 'delete', ctx: Ctx, _write?: true): boolean | Filter | Rule {
  if (ctx.role === 'service') return true;
  const p = POLICIES[table];
  if (!p || ctx.role === 'none') return false;
  const access = p[op];
  if (typeof access === 'function') return access(ctx);
  // A rule whose rows aren't reachable for this role at all is a plain refusal.
  return access.using(ctx) === false ? false : access;
}
