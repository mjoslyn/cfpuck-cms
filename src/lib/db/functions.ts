// The server's functions, called as db.rpc(name, args): what were SQL functions in the database
// (migrations up to *_awaiting_password.sql), now here. Most are queries through the query layer;
// those that need more (counters, a capacity check, row filters made from a segment's rules) run
// SQLite with values bound. Times come from the server's clock, as ISO strings. Only editors may call
// `campaign_stats` and `ticket_sold`; the rest are the server's.
import { Db, type CallSpec } from './query';
import { SqlError, type SqliteExecutor } from './sqlite';
import type { Ctx } from './policies';

interface Fn {
  /** Signed-in editors may call it too (as themselves: reads follow the policies). */
  editors?: boolean;
  /** It pages its own rows (limit/offset). */
  pages?: boolean;
  run(exec: SqliteExecutor, args: Record<string, any>, spec: CallSpec): Promise<unknown>;
}

const SERVICE: Ctx = { role: 'service' };
const now = () => new Date().toISOString();
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const DAY = 86_400_000;

/** The same database, as the server (for the functions that ran with the owner's rights). */
const serviceDb = (exec: SqliteExecutor) => new Db(exec.as(SERVICE));

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

/** A JSON value's text, as Postgres's ->> gave it (booleans as 'true' and 'false'). */
const jsonText = (doc: string, path: string) =>
  `(CASE json_type(${doc}, ${path}) WHEN 'true' THEN 'true' WHEN 'false' THEN 'false' WHEN 'null' THEN NULL ELSE CAST(json_extract(${doc}, ${path}) AS TEXT) END)`;

/** A JSON path for one key ($."key"). */
const keyPath = (key: string) => `$."${key.replace(/["\\]/g, '\\$&')}"`;

/** Whether `c` (a contact) is an active member (of `levels`, if any). */
const memberSql = (levels: string[], add: (v: unknown) => string) =>
  `EXISTS (SELECT 1 FROM members m WHERE lower(m.email) = c.email AND m.status = 'active' AND (m.expires_on IS NULL OR m.expires_on >= ${add(now().slice(0, 10))})${levels.length ? ` AND m.level IN (SELECT value FROM json_each(${add(JSON.stringify(levels))}))` : ''})`;

/** A segment's rules as a condition on `c` (contacts), as mail_rule and mail_segment_match had them. */
function segmentSql(segment: any, add: (v: unknown) => string): string {
  const rules = Array.isArray(segment?.rules) ? segment.rules : [];
  if (!segment || !rules.length) return '1';
  const days = (r: any) => add(ago(Math.max(Math.trunc(Number(r.days) || 0), 0) * DAY));
  const texts = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const rule = (r: any): string => {
    const value = () => add(String(r.value ?? '').toLowerCase());
    const field = () => `coalesce(${jsonText('c.attributes', add(keyPath(String(r.key ?? ''))))}, '')`;
    let cond: string;
    switch (r.type) {
      case 'list': {
        const lists = texts(r.lists).map(Number);
        cond = lists.length ? `EXISTS (SELECT 1 FROM contact_lists cl WHERE cl.contact_id = c.id AND cl.status = 'subscribed' AND cl.list_id IN (SELECT value FROM json_each(${add(JSON.stringify(lists))})))` : '0';
        break;
      }
      case 'tag':
        cond = `EXISTS (SELECT 1 FROM json_each(c.tags) AS t WHERE t.value IN (SELECT value FROM json_each(${add(JSON.stringify(texts(r.tags).map((t) => t.toLowerCase())))})))`;
        break;
      case 'field':
        cond = r.op === 'set' ? `${field()} <> ''`
          : r.op === 'equals' ? `lower(${field()}) = ${value()}`
          : r.op === 'contains' ? `instr(lower(${field()}), ${value()}) > 0`
          : '0';
        break;
      case 'member':
        cond = memberSql(texts(r.levels), add);
        break;
      case 'joined':
        cond = `coalesce(c.confirmed_at, c.consent_at, c.created_at) >= ${days(r)}`;
        break;
      case 'opened':
      case 'clicked':
        cond = `EXISTS (SELECT 1 FROM campaign_sends s WHERE s.contact_id = c.id AND s.${r.type}_at >= ${days(r)})`;
        break;
      case 'source':
        cond = `instr(lower(c.consent_source), ${value()}) > 0`;
        break;
      default:
        cond = '0';
    }
    const not = r.not === true || r.not === 'true';
    return `${not ? 'NOT ' : ''}coalesce(${cond}, 0)`;
  };
  return `(${rules.map(rule).join(segment.match === 'any' ? ' OR ' : ' AND ')})`;
}

export const FUNCTIONS: Record<string, Fn> = {
  /**
   * Entries the full-text index matches for `p_query` (FTS5's syntax), best first: BM25 with the title
   * weighing most, then the excerpt, then the text. At most `p_limit` (default 1000), as [{ id, rank }].
   * `p_status` and `p_types` (optional) narrow the candidates first, so the best are drawn from entries
   * that can be shown. Entries whose SEO settings leave them out of the site's search (`seo.nosearch`)
   * never match.
   */
  entry_search: {
    async run(exec, a) {
      const limit = Math.min(Math.max(Math.trunc(Number(a.p_limit) || 1000), 1), 5000);
      const types = Array.isArray(a.p_types) ? a.p_types.map(String) : null;
      return exec.rows<{ id: number; rank: number }>(
        `SELECT entries_fts.rowid AS id, bm25(entries_fts, 10.0, 4.0, 1.0) AS rank FROM entries_fts JOIN entries AS e ON e.id = entries_fts.rowid
         WHERE entries_fts MATCH ?1 AND (?2 IS NULL OR e.status = ?2) AND (?3 IS NULL OR e.type IN (SELECT value FROM json_each(?3)))
           AND coalesce(json_extract(e.fields, '$.seo.nosearch'), 0) = 0
         ORDER BY rank LIMIT ${limit}`,
        [String(a.p_query ?? ''), a.p_status == null ? null : String(a.p_status), types ? JSON.stringify(types) : null],
      );
    },
  },

  redirect_hit: {
    async run(exec, a) {
      await exec.changes('UPDATE redirects SET hits = hits + 1, last_hit_at = ?2 WHERE id = ?1', [a.redirect_id, now()]);
      return null;
    },
  },

  /** Logs an address not found (at most 5,000, those unseen for 30 days making room). */
  not_found_hit: {
    async run(exec, a) {
      const path = String(a.hit_path ?? '').slice(0, 500);
      const referrer = String(a.hit_referrer ?? '').slice(0, 500);
      const seen = await exec.changes(`UPDATE not_found SET hits = hits + 1, last_seen_at = ?3, referrer = CASE WHEN ?2 <> '' THEN ?2 ELSE referrer END WHERE path = ?1`, [path, referrer, now()]);
      if (seen) return null;
      const count = async () => Number((await exec.rows<{ n: number }>('SELECT count(*) AS n FROM not_found'))[0].n);
      if ((await count()) >= 5000) {
        await exec.changes('DELETE FROM not_found WHERE last_seen_at < ?1', [ago(30 * DAY)]);
        if ((await count()) >= 5000) return null;
      }
      await exec.changes(`INSERT INTO not_found (path, referrer) VALUES (?1, ?2) ON CONFLICT (path) DO UPDATE SET hits = not_found.hits + 1, last_seen_at = ?3`, [path, referrer, now()]);
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
   * Holds an order's tickets if the capacities allow, counting paid orders and unexpired holds: the
   * check and the insert are one statement, so two orders can't both take the last tickets (D1 runs
   * one statement at a time). `p_limits.client` limits one buyer (by address, and by email) for the
   * event, in the same statement: orders not paid for in the last hour (holds, free orders, expired and
   * cancelled ones), and tickets held unpaid now (with free tickets taken in the last hour).
   */
  ticket_order_create: {
    async run(exec, a) {
      const order = a.p_order ?? {};
      const limits = a.p_limits ?? {};
      const entry = Number(order.entry_id);
      const occurrence = String(order.occurrence ?? '');
      const items = ((order.items ?? []) as { type: string; quantity: number }[]).map((i) => ({ ...i, quantity: Math.trunc(Number(i.quantity)) }));
      const want = items.reduce((n, i) => n + i.quantity, 0);
      const row = {
        token: order.token, code: order.code, entry_id: entry, occurrence, event_title: order.event_title ?? '', page: order.page ?? '',
        member_id: order.member_id || null, status: order.status, provider: order.provider, name: order.name, email: order.email, phone: order.phone ?? '',
        address: order.address ?? null, answers: order.answers ?? {}, items, quantity: want, amount: Math.trunc(Number(order.amount)), currency: order.currency ?? 'usd',
        expires_at: order.expires_at || null, paid_at: order.paid_at || null, ip: String(order.ip ?? ''),
      };
      const client = limits.client as { orders: number; tickets: number } | undefined;
      // One buyer's share: by address (none under astro dev) and by email.
      const clientConds = (add: (v: unknown) => string) => {
        if (!client) return [];
        const hour = add(ago(3600_000));
        const unpaid = `NOT (o.provider <> 'free' AND o.status IN ('paid', 'refunded'))`;
        const orders = (who: string) => `(SELECT count(*) FROM ticket_orders AS o WHERE o.entry_id = ${add(entry)} AND ${who} AND o.created_at >= ${hour} AND ${unpaid}) < ${add(client.orders)}`;
        const conds = [orders(`lower(o.email) = lower(${add(row.email)})`)];
        if (row.ip) {
          conds.push(orders(`o.ip = ${add(row.ip)}`));
          const held = `(o.status = 'pending' AND o.expires_at > ${add(now())}) OR (o.provider = 'free' AND o.status = 'paid' AND o.created_at >= ${hour})`;
          conds.push(`(SELECT coalesce(sum(o.quantity), 0) FROM ticket_orders AS o WHERE o.entry_id = ${add(entry)} AND o.ip = ${add(row.ip)} AND (${held})) + ${add(want)} <= ${add(client.tickets)}`);
        }
        return conds;
      };
      const made = await exec.as(SERVICE).insertIf('ticket_orders', row, (add) => {
        const held = `o.entry_id = ${add(entry)} AND o.occurrence = ${add(occurrence)} AND (o.status = 'paid' OR (o.status = 'pending' AND o.expires_at > ${add(now())}))`;
        const taken = (type?: string) =>
          `(SELECT coalesce(sum(CAST(json_extract(i.value, '$.quantity') AS INTEGER)), 0) FROM ticket_orders AS o, json_each(o.items) AS i WHERE ${held}${type === undefined ? '' : ` AND CAST(json_extract(i.value, '$.type') AS TEXT) = ${add(type)}`})`;
        const conds = ['1', ...clientConds(add)];
        for (const i of items) {
          const limit = limitOf(limits.types?.[i.type]);
          if (limit !== null) conds.push(`${taken(String(i.type))} + ${add(i.quantity)} <= ${add(limit)}`);
        }
        const total = limitOf(limits.total);
        if (total !== null) conds.push(`${taken()} + ${add(want)} <= ${add(total)}`);
        return conds.join(' AND ');
      });
      if (made) return { ok: true, id: made.id as number };
      // Refused: the buyer's own limit, or which capacity, from what is taken now.
      if (client) {
        const values: unknown[] = [];
        const add = (v: unknown) => (values.push(v), `?${values.length}`);
        const [r] = await exec.rows<{ ok: number }>(`SELECT ${clientConds(add).join(' AND ')} AS ok`, values);
        if (!r?.ok) return { ok: false, client: true };
      }
      const sold = Object.fromEntries((await ticketSold(serviceDb(exec), entry, occurrence)).map((s) => [s.type, s.quantity]));
      for (const i of items) {
        const limit = limitOf(limits.types?.[i.type]);
        if (limit !== null && (sold[i.type] ?? 0) + i.quantity > limit) return { ok: false, type: i.type, left: Math.max(limit - (sold[i.type] ?? 0), 0) };
      }
      const all = Object.values(sold).reduce((n, q) => n + q, 0);
      return { ok: false, left: Math.max((limitOf(limits.total) ?? all) - all, 0) };
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
      const rows = must(await db.from('contacts').select('id, email_hash, contact_lists!inner(list_id)').in('id', ids).eq('status', 'subscribed')
        .eq('contact_lists.status', 'subscribed').in('contact_lists.list_id', a.p_lists ?? [])) as { id: number; email_hash: string }[];
      const hashes = rows.map((r) => r.email_hash);
      const suppressed = new Set(hashes.length ? (must(await db.from('mail_suppressions').select('email_hash').in('email_hash', hashes)) as { email_hash: string }[]).map((s) => s.email_hash) : []);
      return rows.filter((r) => !suppressed.has(r.email_hash)).map((r) => r.id);
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
        return `?${values.length}`;
      };
      const lists = Array.isArray(a.p_lists) ? (a.p_lists as number[]).map(Number) : null;
      const members = a.p_members ?? 'any';
      const where = [
        `c.status = 'subscribed'`,
        `EXISTS (SELECT 1 FROM contact_lists cl WHERE cl.contact_id = c.id AND cl.status = 'subscribed'${lists ? (lists.length ? ` AND cl.list_id IN (SELECT value FROM json_each(${add(JSON.stringify(lists))}))` : ' AND 0') : ''})`,
        `NOT EXISTS (SELECT 1 FROM mail_suppressions s WHERE s.email_hash = c.email_hash)`,
        members === 'any' ? '1' : `${members === 'members' ? '' : 'NOT '}${memberSql(((a.p_levels ?? []) as string[]).map(String), add)}`,
        segmentSql(a.p_segment, add),
      ];
      const page = `${spec.limit !== undefined ? ` LIMIT ${Math.max(0, Math.trunc(spec.limit))}` : spec.offset ? ' LIMIT -1' : ''}${spec.offset ? ` OFFSET ${Math.max(0, Math.trunc(spec.offset))}` : ''}`;
      const rows = await exec.rows<{ id: number; email: string; name: string; attributes: string }>(`SELECT c.id, c.email, c.name, c.attributes FROM contacts c WHERE ${where.join(' AND ')} ORDER BY c.id${page}`, values);
      return rows.map((r) => ({ ...r, attributes: JSON.parse(r.attributes || '{}') }));
    },
  },

  /** A campaign's numbers from its sends. */
  campaign_stats: {
    editors: true,
    async run(exec, a) {
      const n = (cond: string) => `sum(case when ${cond} then 1 else 0 end)`;
      const [row] = await exec.rows<Record<string, number | null>>(`select
        ${n(`s.status <> 'dropped'`)} as recipients, ${n(`s.status = 'queued'`)} as queued, ${n(`s.status = 'dropped'`)} as dropped,
        ${n(`s.status not in ('queued', 'dropped')`)} as sent, ${n('s.delivered_at is not null')} as delivered, ${n('s.bounced_at is not null')} as bounced,
        ${n('s.complained_at is not null')} as complained, ${n('s.unsubscribed_at is not null')} as unsubscribed, ${n('s.opened_at is not null')} as opened,
        ${n('s.clicked_at is not null')} as clicked, ${n('s.human_confirmed_at is not null')} as confirmed, ${n('s.machine_clicked_at is not null')} as machine
        from campaign_sends s where s.campaign_id = ?1`, [a.p_id]);
      // With no sends, every count is 0, as count(*) gave; keys in jsonb's order (length, then text), as before.
      const keys = Object.keys(row).sort((x, y) => x.length - y.length || (x < y ? -1 : 1));
      return Object.fromEntries(keys.map((k) => [k, Number(row[k] ?? 0)]));
    },
  },

  // Postgres's id sequences had to be moved past the ids a sync wrote; SQLite's next id is past the
  // largest there already, so there is nothing to do. Kept so either copy answers the call.
  sync_reset_ids: {
    async run() {
      return null;
    },
  },
};

/** Runs a function call for the executor's role. */
export async function callFunction(exec: SqliteExecutor, spec: CallSpec): Promise<{ data: unknown; paged: boolean }> {
  const fn = FUNCTIONS[spec.fn];
  if (!fn) throw new SqlError({ message: `Could not find the function public.${spec.fn} in the schema cache`, code: 'PGRST202', details: null, hint: null });
  const { role } = exec.ctx;
  if (role !== 'service' && !(fn.editors && (role === 'editor' || role === 'admin'))) {
    throw new SqlError({ message: `permission denied for function ${spec.fn}`, code: '42501', details: null, hint: null });
  }
  return { data: await fn.run(exec, spec.args, spec), paged: !!fn.pages };
}
