// The server's functions, called as db.rpc(name, args): what were SQL functions in the database
// (migrations up to *_awaiting_password.sql), now here. Most are queries through the query layer;
// those that need more (counters, a lock, row filters made from a segment's rules) run SQL with
// values bound, Postgres for now (docs/cloudflare-migration.md, phase 5 moves them to SQLite). Times
// come from the server's clock, as ISO strings. Only editors may call `campaign_stats` and
// `ticket_sold`; the rest are the server's.
import { createHash } from 'node:crypto';
import { Db, type CallSpec } from './query';
import { SqlError, SqlExecutor, transaction, type Runner } from './sql';
import type { Ctx } from './policies';

interface Fn {
  /** Signed-in editors may call it too (as themselves: reads follow the policies). */
  editors?: boolean;
  /** It pages its own rows (limit/offset). */
  pages?: boolean;
  run(exec: SqlExecutor, args: Record<string, any>, spec: CallSpec): Promise<unknown>;
}

const SERVICE: Ctx = { role: 'service' };
const now = () => new Date().toISOString();
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const DAY = 86_400_000;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** The same connection, as the server (for the functions that ran with the owner's rights). */
const serviceDb = (exec: SqlExecutor) => new Db(new SqlExecutor(SERVICE, exec.run));

/** Rows of a SQL query as the query layer answers them (JSON: numbers, ISO times). */
async function rowsOf(run: Runner, text: string, values: unknown[]): Promise<any[]> {
  const res = await run.query(`select coalesce(json_agg(r), '[]'::json) as rows from (${text}) as r`, values);
  return res.rows[0].rows;
}

const must = <T>(r: { data: T; error: { message: string; code: string } | null }): T => {
  if (r.error) throw new SqlError({ ...r.error, details: null, hint: null });
  return r.data;
};

/** Tickets taken per type for an event and date: paid orders and unexpired holds. */
async function ticketSold(db: Db, entry: number, occurrence: string | null): Promise<{ type: string; quantity: number }[]> {
  const orders = must(await db.from('ticket_orders').select('items')
    .eq('entry_id', entry).eq('occurrence', occurrence ?? '')
    .or(`status.eq.paid,and(status.eq.pending,expires_at.gt.${now()})`));
  const sold = new Map<string, number>();
  for (const o of orders as { items: { type: string; quantity: number | string }[] }[]) {
    for (const i of o.items ?? []) sold.set(String(i.type), (sold.get(String(i.type)) ?? 0) + Math.trunc(Number(i.quantity)));
  }
  return [...sold].map(([type, quantity]) => ({ type, quantity }));
}

const limitOf = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));

/** A segment's rules as a condition on `c` (contacts), as mail_rule and mail_segment_match had them. */
function segmentSql(segment: any, add: (v: unknown) => string): string {
  const rules = Array.isArray(segment?.rules) ? segment.rules : [];
  if (!segment || !rules.length) return 'true';
  const days = (r: any) => add(ago(Math.max(Math.trunc(Number(r.days) || 0), 0) * DAY));
  const texts = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const rule = (r: any): string => {
    const value = () => add(String(r.value ?? '').toLowerCase());
    const field = () => `coalesce(c.attributes->>${add(String(r.key ?? ''))}::text, '')`;
    let cond: string;
    switch (r.type) {
      case 'list': {
        const lists = texts(r.lists).map((x) => add(Number(x)));
        cond = lists.length ? `exists (select 1 from contact_lists cl where cl.contact_id = c.id and cl.status = 'subscribed' and cl.list_id in (${lists.join(', ')}))` : 'false';
        break;
      }
      case 'tag':
        cond = `c.tags && ${add(texts(r.tags).map((t) => t.toLowerCase()))}::text[]`;
        break;
      case 'field':
        cond = r.op === 'set' ? `${field()} <> ''`
          : r.op === 'equals' ? `lower(${field()}) = ${value()}`
          : r.op === 'contains' ? `strpos(lower(${field()}), ${value()}) > 0`
          : 'false';
        break;
      case 'member': {
        const levels = texts(r.levels).map(add);
        cond = `exists (select 1 from members m where lower(m.email) = c.email and m.status = 'active' and (m.expires_on is null or m.expires_on >= ${add(now().slice(0, 10))}::date)${levels.length ? ` and m.level in (${levels.join(', ')})` : ''})`;
        break;
      }
      case 'joined':
        cond = `coalesce(c.confirmed_at, c.consent_at, c.created_at) >= ${days(r)}::timestamptz`;
        break;
      case 'opened':
      case 'clicked':
        cond = `exists (select 1 from campaign_sends s where s.contact_id = c.id and s.${r.type}_at >= ${days(r)}::timestamptz)`;
        break;
      case 'source':
        cond = `strpos(lower(c.consent_source), ${value()}) > 0`;
        break;
      default:
        cond = 'false';
    }
    const not = r.not === true || r.not === 'true';
    return `${not ? 'not ' : ''}coalesce(${cond}, false)`;
  };
  return `(${rules.map(rule).join(segment.match === 'any' ? ' or ' : ' and ')})`;
}

export const FUNCTIONS: Record<string, Fn> = {
  redirect_hit: {
    async run(exec, a) {
      await exec.run.query('update redirects set hits = hits + 1, last_hit_at = $2 where id = $1', [a.redirect_id, now()]);
      return null;
    },
  },

  /** Logs an address not found (at most 5,000, those unseen for 30 days making room). */
  not_found_hit: {
    async run(exec, a) {
      const path = String(a.hit_path ?? '').slice(0, 500);
      const referrer = String(a.hit_referrer ?? '').slice(0, 500);
      const run = exec.run;
      const seen = await run.query(`update not_found set hits = hits + 1, last_seen_at = $3, referrer = case when $2 <> '' then $2 else referrer end where path = $1`, [path, referrer, now()]);
      if (seen.rowCount) return null;
      const count = async () => Number((await run.query('select count(*) as n from not_found')).rows[0].n);
      if ((await count()) >= 5000) {
        await run.query('delete from not_found where last_seen_at < $1', [ago(30 * DAY)]);
        if ((await count()) >= 5000) return null;
      }
      await run.query(`insert into not_found (path, referrer) values ($1, $2) on conflict (path) do update set hits = not_found.hits + 1, last_seen_at = $3`, [path, referrer, now()]);
      return null;
    },
  },

  ticket_sold: {
    editors: true,
    run: (exec, a) => ticketSold(new Db(exec), Number(a.p_entry), a.p_occurrence ?? ''),
  },

  /** A buyer's order by its token (long enough not to be guessed). */
  ticket_order_status: {
    async run(exec, a) {
      const token = String(a.p_token ?? '');
      if (token.length < 24) return [];
      return must(await serviceDb(exec).from('ticket_orders').select('code, status, name, email, items, quantity, amount, currency, entry_id, occurrence, event_title, paid_at').eq('token', token));
    },
  },

  /**
   * Holds an order's tickets if the capacities allow: one order at a time per event and date (a
   * Postgres advisory lock for the transaction), counting paid orders and unexpired holds.
   */
  ticket_order_create: {
    async run(exec, a) {
      const order = a.p_order ?? {};
      const limits = a.p_limits ?? {};
      const entry = Number(order.entry_id);
      const occurrence = String(order.occurrence ?? '');
      return transaction(exec.run, async (run) => {
        await run.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`tickets:${entry}:${occurrence}`]);
        const db = new Db(new SqlExecutor(SERVICE, run));
        const taken = Object.fromEntries((await ticketSold(db, entry, occurrence)).map((s) => [s.type, s.quantity]));
        const all = Object.values(taken).reduce((n, q) => n + q, 0);
        const items = (order.items ?? []) as { type: string; quantity: number }[];
        const want = items.reduce((n, i) => n + Math.trunc(Number(i.quantity)), 0);
        for (const i of items) {
          const limit = limitOf(limits.types?.[i.type]);
          if (limit !== null && (taken[i.type] ?? 0) + Math.trunc(Number(i.quantity)) > limit) return { ok: false, type: i.type, left: Math.max(limit - (taken[i.type] ?? 0), 0) };
        }
        const total = limitOf(limits.total);
        if (total !== null && all + want > total) return { ok: false, left: Math.max(total - all, 0) };
        const made = must(await db.from('ticket_orders').insert({
          token: order.token, code: order.code, entry_id: entry, occurrence, event_title: order.event_title ?? '', page: order.page ?? '',
          member_id: order.member_id || null, status: order.status, provider: order.provider, name: order.name, email: order.email, phone: order.phone ?? '',
          address: order.address ?? null, answers: order.answers ?? {}, items, quantity: want, amount: Math.trunc(Number(order.amount)), currency: order.currency ?? 'usd',
          expires_at: order.expires_at || null, paid_at: order.paid_at || null,
        }).select('id').single());
        return { ok: true, id: (made as { id: number }).id };
      });
    },
  },

  /** Claims a campaign to send (no other run holds it, or that run went quiet 16 minutes ago). */
  mail_claim: {
    async run(exec, a) {
      const db = serviceDb(exec);
      const at = now();
      const claimed = must(await db.from('campaigns').update({ claim_token: a.p_token, claimed_at: at, status: 'sending' })
        .eq('id', a.p_id).in('status', ['scheduled', 'sending']).or(`claim_token.is.null,claimed_at.lt.${ago(16 * 60_000)}`).select('id, started_at')) as { started_at: string | null }[];
      if (claimed.length && !claimed[0].started_at) await db.from('campaigns').update({ started_at: at }).eq('id', a.p_id).is('started_at', null);
      return claimed.length > 0;
    },
  },

  /** Claims a digest's issue for a week (`p_key`), once. */
  mail_digest_claim: {
    async run(exec, a) {
      const key = String(a.p_key ?? '');
      const won = must(await serviceDb(exec).from('digests').update({ last_run_key: key, last_run_at: now() })
        .eq('id', a.p_id).or(`last_run_key.is.null,last_run_key.neq."${key.replace(/["\\]/g, '\\$&')}"`).select('id')) as unknown[];
      return won.length > 0;
    },
  },

  /** Which of `p_ids` are still subscribed to any of `p_lists` and not suppressed. */
  mail_still_subscribed: {
    async run(exec, a) {
      const ids = (a.p_ids ?? []) as number[];
      if (!ids.length) return [];
      const db = serviceDb(exec);
      const rows = must(await db.from('contacts').select('id, email, contact_lists!inner(list_id)').in('id', ids).eq('status', 'subscribed')
        .eq('contact_lists.status', 'subscribed').in('contact_lists.list_id', a.p_lists ?? [])) as { id: number; email: string }[];
      const hashes = rows.map((r) => sha256(r.email));
      const suppressed = new Set(hashes.length ? (must(await db.from('mail_suppressions').select('email_hash').in('email_hash', hashes)) as { email_hash: string }[]).map((s) => s.email_hash) : []);
      return rows.filter((r) => !suppressed.has(sha256(r.email))).map((r) => r.id);
    },
  },

  /**
   * A campaign's or digest's recipients: subscribed, on any of `p_lists` (null: any list), not
   * suppressed, members or not (of `p_levels`), matching the segment's rules; by id, paged.
   */
  mail_audience: {
    pages: true,
    async run(exec, a, spec) {
      const values: unknown[] = [];
      const add = (v: unknown) => {
        values.push(v);
        return `$${values.length}`;
      };
      // Every value added is used: Postgres refuses a statement with a parameter it can't place.
      const lists = Array.isArray(a.p_lists) ? (a.p_lists as number[]).map((l) => add(Number(l))) : null;
      const members = a.p_members ?? 'any';
      const isMember = () => {
        const levels = ((a.p_levels ?? []) as string[]).map(add);
        return `exists (select 1 from members m where lower(m.email) = c.email and m.status = 'active' and (m.expires_on is null or m.expires_on >= ${add(now().slice(0, 10))}::date)${levels.length ? ` and m.level in (${levels.join(', ')})` : ''})`;
      };
      const where = [
        `c.status = 'subscribed'`,
        `exists (select 1 from contact_lists cl where cl.contact_id = c.id and cl.status = 'subscribed'${lists ? (lists.length ? ` and cl.list_id in (${lists.join(', ')})` : ' and false') : ''})`,
        `not exists (select 1 from mail_suppressions s where s.email_hash = encode(extensions.digest(c.email, 'sha256'), 'hex'))`,
        members === 'any' ? 'true' : `${members === 'members' ? '' : 'not '}${isMember()}`,
        segmentSql(a.p_segment, add),
      ];
      const page = `${spec.limit !== undefined ? ` limit ${Math.max(0, Math.trunc(spec.limit))}` : ''}${spec.offset ? ` offset ${Math.max(0, Math.trunc(spec.offset))}` : ''}`;
      return rowsOf(exec.run, `select c.id, c.email, c.name, c.attributes from contacts c where ${where.join(' and ')} order by c.id${page}`, values);
    },
  },

  /** A campaign's numbers from its sends. */
  campaign_stats: {
    editors: true,
    async run(exec, a) {
      const n = (cond: string) => `sum(case when ${cond} then 1 else 0 end)::int`;
      const res = await exec.run.query(`select
        ${n(`s.status <> 'dropped'`)} as recipients, ${n(`s.status = 'queued'`)} as queued, ${n(`s.status = 'dropped'`)} as dropped,
        ${n(`s.status not in ('queued', 'dropped')`)} as sent, ${n('s.delivered_at is not null')} as delivered, ${n('s.bounced_at is not null')} as bounced,
        ${n('s.complained_at is not null')} as complained, ${n('s.unsubscribed_at is not null')} as unsubscribed, ${n('s.opened_at is not null')} as opened,
        ${n('s.clicked_at is not null')} as clicked, ${n('s.human_confirmed_at is not null')} as confirmed, ${n('s.machine_clicked_at is not null')} as machine
        from campaign_sends s where s.campaign_id = $1`, [a.p_id]);
      // With no sends, every count is 0, as count(*) gave; keys in jsonb's order (length, then text), as before.
      const keys = Object.keys(res.rows[0]).sort((x, y) => x.length - y.length || (x < y ? -1 : 1));
      return Object.fromEntries(keys.map((k) => [k, Number(res.rows[0][k] ?? 0)]));
    },
  },

  // Postgres's id sequences: this goes with them (phase 5).
  sync_reset_ids: {
    async run(exec) {
      await exec.run.query('select public.sync_reset_ids()');
      return null;
    },
  },
};

/** Runs a function call for the executor's role. */
export async function callFunction(exec: SqlExecutor, spec: CallSpec): Promise<{ data: unknown; paged: boolean }> {
  const fn = FUNCTIONS[spec.fn];
  if (!fn) throw new SqlError({ message: `Could not find the function public.${spec.fn} in the schema cache`, code: 'PGRST202', details: null, hint: null });
  const { role } = exec.ctx;
  if (role !== 'service' && !(fn.editors && (role === 'editor' || role === 'admin'))) {
    throw new SqlError({ message: `permission denied for function ${spec.fn}`, code: '42501', details: null, hint: null });
  }
  return { data: await fn.run(exec, spec.args, spec), paged: !!fn.pages };
}
