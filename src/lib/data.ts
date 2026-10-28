// Per-request data loader with caches. Everything a page needs is fetched here before rendering,
// because the block renderers are synchronous.
import type { Db } from './db/query';
import type { Data } from '@puckeditor/core';
import { ENTRY_COLUMNS, type Entry, type Media, type Term } from './types';
import { RECURRENCE_KEY, expandEntry, defaultHorizon, occurrenceDates, recurrenceOf } from './recurrence';
import type { FormRow } from './forms/types';
import { allRows } from './rows';
import { uniqueAreas } from './content/areas';
import { isActive, type Viewer } from './members/config';

/** Ids in groups small enough for one `in` filter (and one response). */
const chunks = (ids: number[], size = 200) => Array.from({ length: Math.ceil(ids.length / size) }, (_, i) => ids.slice(i * size, (i + 1) * size));

export interface QueryArgs {
  postType: string | string[];
  perPage: number;
  offset?: number;
  page?: number;
  order?: 'asc' | 'desc';
  /** `include`: the order of `include` (hand-picked entries). */
  orderBy?: 'date' | 'title' | 'menu_order' | 'menu_order_title' | 'rand' | 'event_start' | 'modified' | 'include' | 'relevance';
  search?: string;
  exclude?: number[];
  include?: number[];
  /** taxonomy -> term ids (our ids) */
  terms?: Record<string, number[]>;
  parents?: number[];
  upcoming?: boolean;
  /** Only entries marked featured (fields.featured); e.g. an unfiltered member directory. */
  featuredOnly?: boolean;
}

export interface QueryResult {
  ids: number[];
  total: number;
  pages: number;
}

/** A search's words. Characters that mean something in a filter (%, _, comma, brackets) separate words,
 *  so "(annual)" finds "Annual Report". */
const searchWords = (search?: string) => (search ?? '').replace(/[%_,()]/g, ' ').split(/\s+/).filter(Boolean);

/** A search as a full-text query: every word, each matching the start of a word ("tow" finds "town"). */
const ftsQuery = (search?: string) => searchWords(search).map((w) => `"${w.replace(/"/g, '""')}"*`).join(' ');

/**
 * What a Loader may read for whom. `published`: the site's view, for the server's key (which the
 * database doesn't filter): published entries only, and members-only ones (fields.access) only for an
 * editor or a member of their levels (`viewer`). Without it (an editor's own session: the editor's
 * canvas, previews) the database's policies decide.
 */
export interface LoaderScope {
  published: true;
  viewer?: Viewer | null;
  /** Events are off (Settings > Events): no event entries. */
  noEvents?: boolean;
}

/** The site's view for anyone: published entries, none of them members-only. */
export const PUBLIC_SCOPE: LoaderScope = { published: true };

/** The level whose members-only entries a viewer sees: an active member's (level ids are slugs: safe in a filter). */
const memberLevel = (v?: Viewer | null) => (isActive(v?.member) && /^[a-z0-9-]+$/.test(v!.member!.level) ? v!.member!.level : null);
/** Members-only entries for any level, or for this one (an or() condition). */
const forLevel = (level: string) => `fields->access->levels.is.null,fields->access->levels.eq.[],fields->access->levels.cs.["${level}"]`;

/** An entries query (a PostgREST filter builder) limited to what a scope's viewer may see. */
export function visibleTo<Q>(query: Q, scope: LoaderScope | undefined): Q {
  if (!scope) return query;
  // Typed loosely: the builder's own types are too deep to pass through a generic helper.
  let q = (query as any).eq('status', 'publish');
  if (scope.noEvents) q = q.neq('type', 'event');
  const v = scope.viewer;
  if (v?.editor) return q;
  const open = 'fields->access->>members.is.null,fields->access->>members.neq.true';
  // A member also sees entries for any level, and for theirs.
  const level = memberLevel(v);
  return level ? q.or(`${open},${forLevel(level)}`) : q.or(open);
}

/** The published entries visibleTo() leaves out for being members-only; null when the scope hides none. */
function hiddenFrom<Q>(query: Q, scope: LoaderScope | undefined): Q | null {
  if (!scope || scope.viewer?.editor) return null;
  let q = (query as any).eq('status', 'publish').eq('fields->access->>members', 'true');
  if (scope.noEvents) q = q.neq('type', 'event');
  const level = memberLevel(scope.viewer);
  return level ? q.or(`not.or(${forLevel(level)})`) : q;
}

export class Loader {
  entries = new Map<number, Entry>();
  media = new Map<number, Media>();
  terms = new Map<number, Term>();
  private termsLoaded = false;
  private settingsCache?: Record<string, any>;
  private templates = new Map<string, Data | null>();
  /** Former addresses of renamed templates (`kind:slug` -> slug now), read once on the first miss. */
  private formerSlugs?: Promise<Map<string, string>>;
  private recurring?: Promise<boolean>;
  private formsCache?: Promise<FormRow[]>;
  private hiddenCache?: Promise<Set<number>>;
  /**
   * A list or lookup left out a members-only entry this scope hides: what the page shows depends on who
   * views it (RenderCtx.personal), so it is rendered again for a signed-in visitor.
   */
  hidMembersOnly = false;

  constructor(public db: Db, public now = new Date(), public scope?: LoaderScope) {}

  private visible<Q>(q: Q): Q {
    return visibleTo(q, this.scope);
  }

  async settings(): Promise<Record<string, any>> {
    if (!this.settingsCache) {
      const { data, error } = await this.db.from('settings').select('key, value');
      if (error) throw error;
      this.settingsCache = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
    }
    return this.settingsCache!;
  }

  async allTerms(): Promise<Term[]> {
    if (!this.termsLoaded) {
      const { data, error } = await allRows(this.db.from('terms').select('*').order('id'));
      if (error) throw error;
      for (const t of data ?? []) this.terms.set(t.id, t);
      this.termsLoaded = true;
    }
    return [...this.terms.values()];
  }

  async termById(id: number) {
    return (await this.allTerms()).find((t) => t.id === id);
  }

  async termBySlug(taxonomy: string, slug: string) {
    return (await this.allTerms()).find((t) => t.taxonomy === taxonomy && t.slug === slug);
  }

  async template(kind: 'template' | 'part' | 'pattern' | 'navigation', slug: string): Promise<Data | null> {
    const key = `${kind}:${slug}`;
    if (!this.templates.has(key)) {
      const at = () => this.db.from('templates').select('content, trashed_at').eq('kind', kind).eq('slug', slug).maybeSingle();
      let res = await at();
      // A database without the trash column yet (code deployed before its migration) reads as before.
      if (res.error) res = (await this.db.from('templates').select('content').eq('kind', kind).eq('slug', slug).maybeSingle()) as typeof res;
      if (res.error) throw res.error;
      // One in the trash isn't there.
      const data = res.data && !res.data.trashed_at ? res.data : null;
      let doc: Data | null = (data?.content as Data) ?? null;
      // None at that address: one renamed from it, if any (a template at the address itself comes first).
      if (!data) {
        const now = (await this.renamed()).get(key);
        if (now) doc = await this.template(kind, now);
      }
      // Each Page content block shows its own area, even in a template saved before that was enforced.
      if (doc && kind === 'template' && Array.isArray(doc.content)) doc = { ...doc, content: uniqueAreas(doc.content as any[]) as Data['content'] };
      this.templates.set(key, doc);
    }
    return this.templates.get(key)!;
  }

  private renamed(): Promise<Map<string, string>> {
    this.formerSlugs ??= (async () => {
      const map = new Map<string, string>();
      const { data, error } = await this.db.from('templates').select('kind, slug, former_slugs').is('trashed_at', null);
      // The fallback is a convenience: a database without the column yet (code deployed before its
      // migration) renders as before.
      if (error) {
        console.error('Former template addresses:', error.message);
        return map;
      }
      for (const t of data ?? []) for (const f of (t.former_slugs as string[] | null) ?? []) map.set(`${t.kind}:${f}`, t.slug);
      return map;
    })();
    return this.formerSlugs;
  }

  private remember(rows: any[]) {
    for (const r of rows) {
      const e = r as Entry & { entry_terms?: { term_id: number; sort: number }[] };
      if (e.entry_terms) {
        e.term_ids = e.entry_terms.sort((a, b) => a.sort - b.sort).map((t) => t.term_id);
        delete e.entry_terms;
      }
      this.entries.set(e.id, { ...this.entries.get(e.id), ...e });
    }
  }

  /** The ids of the published entries this scope hides for being members-only (usually none), read once. */
  private hidden(): Promise<Set<number>> {
    this.hiddenCache ??= (async () => {
      const q = hiddenFrom(this.db.from('entries').select('id'), this.scope);
      if (!q) return new Set<number>();
      const { data, error } = await allRows(q.order('id'));
      if (error) throw error;
      return new Set((data ?? []).map((r: any) => r.id as number));
    })();
    return this.hiddenCache;
  }

  /** Notes whether any of these ids, asked for and not found, is an entry this scope hides for being members-only. */
  private async noteHidden(ids: number[]) {
    if (this.hidMembersOnly || !this.scope || !ids.length) return;
    const hidden = await this.hidden();
    if (ids.some((id) => hidden.has(id))) this.hidMembersOnly = true;
  }

  async entry(type: string | string[], slug: string, withContent = true): Promise<Entry | null> {
    const cols = `${ENTRY_COLUMNS}${withContent ? ', content' : ''}, entry_terms(term_id, sort)`;
    let q = this.visible(this.db.from('entries').select(cols).eq('slug', slug).eq('status', 'publish'));
    q = Array.isArray(type) ? q.in('type', type) : q.eq('type', type);
    const { data: rows, error } = await q;
    if (error) throw error;
    // Several types can hold the slug (older entries; saves now refuse it): the first type listed wins.
    const data = Array.isArray(type) ? type.map((t) => (rows as any[]).find((r) => r.type === t)).find(Boolean) : (rows as any[])[0];
    if (!data) return null;
    this.remember([data]);
    return this.entries.get((data as any).id)!;
  }

  /**
   * A published members-only entry this scope's viewer may not see: what anyone may know of it, for its
   * page's sign-in prompt (its address, title, excerpt, featured image, template, search settings and
   * access; never its content or other fields). Null when there is no such entry, or no scope. With
   * `occurrence` (a Y-m-d date), a recurring event's occurrence on that date, as its series' locked entry.
   */
  async lockedEntry(types: string[], slug: string, occurrence?: string): Promise<Entry | null> {
    if (!this.scope) return null;
    const dates = occurrence ? `, recurrence:fields->${RECURRENCE_KEY}, start:fields->>start` : '';
    const { data: rows, error } = await this.db
      .from('entries')
      .select(`id, type, slug, title, title_rendered, excerpt, excerpt_rendered, status, template, parent_id, menu_order, featured_media_id, published_at, updated_at, access:fields->access, seo:fields->seo${dates}`)
      .eq('slug', slug)
      .eq('status', 'publish')
      .in('type', types)
      .eq('fields->access->>members', 'true');
    if (error) throw error;
    const row = types.map((t) => (rows as any[]).find((r) => r.type === t)).find(Boolean);
    if (!row) return null;
    const { access, seo, recurrence, start, ...rest } = row;
    // The date must be one of the series' occurrences; the entry carries none of its dates.
    if (occurrence) {
      const rule = recurrenceOf({ type: rest.type, fields: { [RECURRENCE_KEY]: recurrence } });
      if (!rule || !/^\d{4}-\d{2}-\d{2}/.test(start ?? '') || !occurrenceDates(start.slice(0, 10), rule, defaultHorizon(this.now)).includes(occurrence)) return null;
      rest.occurrence = occurrence;
    }
    const e: Entry = { ...rest, fields: { access, seo }, content: null, event_start: null, event_end: null, event_all_day: null, term_ids: [], locked: true };
    this.entries.set(e.id, e);
    return e;
  }

  async entryById(id: number, withContent = true): Promise<Entry | null> {
    const cached = this.entries.get(id);
    if (cached && (!withContent || cached.content !== undefined)) return cached;
    const q = this.db
      .from('entries')
      .select(`${ENTRY_COLUMNS}${withContent ? ', content' : ''}, entry_terms(term_id, sort)`)
      .eq('id', id);
    const { data, error } = await this.visible(q).maybeSingle();
    if (error) throw error;
    if (data) this.remember([data]);
    else await this.noteHidden([id]);
    return this.entries.get(id) ?? null;
  }

  async entriesByIds(ids: number[]): Promise<Entry[]> {
    const need = [...new Set(ids.filter((id) => id && !this.entries.has(id)))];
    for (const chunk of chunks(need)) {
      const { data, error } = await this.visible(this.db.from('entries').select(`${ENTRY_COLUMNS}, entry_terms(term_id, sort)`).in('id', chunk));
      if (error) throw error;
      this.remember(data ?? []);
    }
    await this.noteHidden(need.filter((id) => !this.entries.has(id)));
    return ids.map((id) => this.entries.get(id)).filter(Boolean) as Entry[];
  }

  /** Load media rows (featured images, image fields) by id, with the images they use for crop shapes. */
  async loadMedia(ids: unknown[]) {
    const fetch = async (list: unknown[]) => {
      const need = [...new Set(list.map(Number).filter((id) => id > 0 && !this.media.has(id)))];
      const got: Media[] = [];
      for (const chunk of chunks(need)) {
        const { data, error } = await this.db.from('media').select('*').in('id', chunk);
        if (error) throw error;
        for (const m of (data ?? []) as Media[]) this.media.set(m.id, m), got.push(m);
      }
      return got;
    };
    const loaded = await fetch(ids);
    // One level: an image's crop replacements (theirs aren't followed).
    const swaps = loaded.filter((m) => m.crop_images && Object.keys(m.crop_images).length);
    if (!swaps.length) return;
    await fetch(swaps.flatMap((m) => Object.values(m.crop_images!).map((c) => c.id)));
    for (const m of swaps) {
      const crop_media: Record<string, Media> = {};
      for (const [shape, c] of Object.entries(m.crop_images!)) {
        const r = this.media.get(Number(c.id));
        if (r && r.id !== m.id && r.mime_type.startsWith('image/')) crop_media[shape] = r;
      }
      m.crop_media = crop_media;
    }
  }

  /** A loaded media row from an id as fields store it (number or numeric string). */
  mediaById(id: unknown): Media | undefined {
    return this.media.get(Number(id));
  }

  /** Published-entry counts per term (to hide empty terms). */
  async termCounts(taxonomy: string): Promise<Map<number, number>> {
    const ids = (await this.allTerms()).filter((t) => t.taxonomy === taxonomy).map((t) => t.id);
    let q = this.db.from('entry_terms').select('entry_id, term_id, entries!inner(status)').in('term_id', ids).eq('entries.status', 'publish');
    // The site's counts leave members-only entries out.
    if (this.scope && !this.scope.viewer?.editor) q = q.or('fields->access->>members.is.null,fields->access->>members.neq.true', { referencedTable: 'entries' });
    const { data, error } = await allRows(q.order('entry_id').order('term_id'));
    if (error) throw error;
    const counts = new Map<number, number>();
    for (const r of data ?? []) counts.set(r.term_id, (counts.get(r.term_id) ?? 0) + 1);
    return counts;
  }

  async query(args: QueryArgs): Promise<QueryResult> {
    const perPage = Math.max(1, args.perPage || 10);
    const page = Math.max(1, args.page ?? 1);
    const offset = (args.offset ?? 0) + (page - 1) * perPage;
    const types = Array.isArray(args.postType) ? args.postType : [args.postType];
    // Each taxonomy constraint must match (AND across taxonomies, IN within one). Matching ids are
    // looked up separately so results still carry all their terms (for post classes, post-terms).
    let matchIds: number[] | null = null;
    for (const ids of Object.values(args.terms ?? {})) {
      if (!ids.length) continue;
      const { data, error } = await allRows(this.db.from('entry_terms').select('entry_id, term_id').in('term_id', ids).order('entry_id').order('term_id'));
      if (error) throw error;
      const set = new Set((data ?? []).map((r) => r.entry_id));
      matchIds = matchIds ? matchIds.filter((id) => set.has(id)) : [...set];
    }
    if (matchIds && !matchIds.length) return { ids: [], total: 0, pages: 0 };
    const select = `${ENTRY_COLUMNS}, entry_terms(term_id, sort)`;
    const fts = ftsQuery(args.search);
    const narrow = (q: any) => {
      q = q.eq('status', 'publish').in('type', types);
      if (matchIds) q = q.in('id', matchIds);
      // Search: every word must start a word of the title, excerpt or text (the full-text index).
      if (fts) q = q.textSearch('fts', fts);
      if (args.featuredOnly) q = q.eq('fields->>featured', 'true');
      if (args.exclude?.length) q = q.not('id', 'in', `(${args.exclude.join(',')})`);
      if (args.include?.length) q = q.in('id', args.include);
      if (args.parents?.length) q = q.in('parent_id', args.parents);
      return q;
    };
    // Whether the list leaves out members-only entries this scope hides: one check, only when there are some.
    if (!this.hidMembersOnly && this.scope) {
      const hidden = await this.hidden();
      if (hidden.size) {
        let h = narrow(this.db.from('entries').select('id').in('id', [...hidden]));
        if (args.upcoming) h = h.or(`event_start.gte.${this.now.toISOString()},fields->${RECURRENCE_KEY}.not.is.null`);
        const { data, error } = await h.limit(1);
        if (error) throw error;
        if (data?.length) this.hidMembersOnly = true;
      }
    }

    let q = narrow(this.visible(this.db.from('entries').select(select, { count: 'exact' })));
    // Search lists a recurring event once (its page leads to the next occurrence), ranked (relevance).
    if (args.orderBy === 'relevance') return this.queryRanked(q, args, perPage, offset);
    if (types.includes('event') && (await this.hasRecurring())) {
      // Upcoming: only the rows that can have a date ahead (a series, or a start still to come), not
      // every past event for the expansion to drop again.
      if (args.upcoming) q = q.or(`event_start.gte.${this.now.toISOString()},fields->${RECURRENCE_KEY}.not.is.null`);
      return this.queryExpanded(q, args, perPage, offset);
    }
    if (args.upcoming) q = q.gte('event_start', this.now.toISOString());

    const orderBy = args.upcoming ? 'event_start' : args.orderBy ?? 'date';
    const ascending = args.upcoming ? true : (args.order ?? 'desc') === 'asc';
    const picked = orderBy === 'include' && args.include?.length;
    if (orderBy !== 'rand' && !picked) {
      if (orderBy === 'menu_order_title') q = q.order('menu_order', { ascending }).order('title', { ascending });
      else {
        const col = ({ date: 'published_at', modified: 'updated_at', title: 'title', menu_order: 'menu_order', event_start: 'event_start' } as Record<string, string>)[orderBy] ?? 'published_at';
        q = q.order(col, { ascending });
      }
    }
    // MySQL resolves ties in insertion (ID) order even for DESC sorts.
    q = q.order('id', { ascending: true });

    // Shuffled and hand-picked lists are ordered and paged here, from every match.
    const { data, error, count } = orderBy !== 'rand' && !picked ? await allRows(q, offset, perPage) : await allRows(q);
    // A page past the end: the database refuses the range; it is simply an empty page.
    if (error?.code === 'PGRST103') {
      const total = Math.max(0, Number(error.details?.match(/only (\d+) rows/)?.[1] ?? 0) - (args.offset ?? 0));
      return { ids: [], total, pages: Math.ceil(total / perPage) };
    }
    if (error) throw error;
    let rows = data ?? [];
    if (orderBy === 'rand') rows = rows.sort(() => Math.random() - 0.5).slice(offset, offset + perPage);
    if (picked) rows = rows.sort((a: any, b: any) => args.include!.indexOf(a.id) - args.include!.indexOf(b.id)).slice(offset, offset + perPage);
    this.remember(rows);
    const total = Math.max(0, (count ?? rows.length) - (args.offset ?? 0));
    return { ids: rows.map((r: any) => r.id), total, pages: Math.ceil(total / perPage) };
  }

  /**
   * query() ordered by relevance to args.search: the full-text index ranks the published matches of the
   * listing's types (BM25, the title weighing most, then the excerpt, then the text; the best 1000), the
   * query keeps those this listing shows, newest first on ties.
   */
  private async queryRanked(q: any, args: QueryArgs, perPage: number, offset: number): Promise<QueryResult> {
    const fts = ftsQuery(args.search);
    if (!fts) return { ids: [], total: 0, pages: 0 };
    // Ranked among what this listing can show (published, its types; events while they are on), so the
    // best 1000 aren't spent on drafts and other types; members-only entries are left out after.
    const types = (Array.isArray(args.postType) ? args.postType : [args.postType]).filter((t) => !(this.scope?.noEvents && t === 'event'));
    if (!types.length) return { ids: [], total: 0, pages: 0 };
    const { data: ranked, error: rankError } = await this.db.rpc('entry_search', { p_query: fts, p_limit: 1000, p_status: 'publish', p_types: types });
    if (rankError) throw rankError;
    const rank = new Map<number, number>(((ranked ?? []) as { id: number; rank: number }[]).map((r) => [r.id, r.rank]));
    if (!rank.size) return { ids: [], total: 0, pages: 0 };
    const { data, error } = await allRows(q.in('id', [...rank.keys()]).order('id'));
    if (error) throw error;
    const rows = (data ?? []).sort((a: any, b: any) => rank.get(a.id)! - rank.get(b.id)! || Date.parse(b.published_at) - Date.parse(a.published_at) || a.id - b.id);
    const page = rows.slice(offset, offset + perPage);
    this.remember(page);
    const total = Math.max(0, rows.length - (args.offset ?? 0));
    return { ids: page.map((r: any) => r.id), total, pages: Math.ceil(total / perPage) };
  }

  /** Whether any published event repeats; if none, event queries stay entirely in SQL. */
  hasRecurring(): Promise<boolean> {
    this.recurring ??= (async () => {
      const { data, error } = await this.db.from('entries').select('id').eq('type', 'event').eq('status', 'publish').not(`fields->${RECURRENCE_KEY}`, 'is', null).limit(1);
      if (error) throw error;
      return !!data?.length;
    })();
    return this.recurring;
  }

  /**
   * query() when recurring events exist: every matching row is fetched and series are expanded into
   * their occurrences, then the upcoming filter, ordering and paging run here.
   */
  private async queryExpanded(q: any, args: QueryArgs, perPage: number, offset: number): Promise<QueryResult> {
    const { data, error } = await allRows(q.order('id'));
    if (error) throw error;
    this.remember(data ?? []);
    const horizon = defaultHorizon(this.now);
    let rows: Entry[] = (data ?? []).flatMap((r: any) => expandEntry(this.entries.get(r.id)!, horizon));
    const now = this.now.getTime();
    if (args.upcoming) rows = rows.filter((e) => e.event_start && Date.parse(e.event_start) >= now);

    const orderBy = args.upcoming ? 'event_start' : args.orderBy ?? 'date';
    const dir = args.upcoming || (args.order ?? 'desc') === 'asc' ? 1 : -1;
    const time = (v: string | null) => (v ? Date.parse(v) : -Infinity);
    const key: Record<string, (e: Entry) => number | string> = {
      date: (e) => time(e.published_at),
      modified: (e) => time(e.updated_at),
      event_start: (e) => time(e.event_start),
      title: (e) => e.title.toLowerCase(),
      menu_order: (e) => e.menu_order,
      include: (e) => args.include?.indexOf(e.series_id ?? e.id) ?? 0,
    };
    const cmp = (a: number | string, b: number | string) => (a < b ? -1 : a > b ? 1 : 0);
    if (orderBy === 'rand') rows.sort(() => Math.random() - 0.5);
    else
      rows.sort((a, b) => {
        const primary =
          orderBy === 'menu_order_title' ? cmp(a.menu_order, b.menu_order) || cmp(a.title.toLowerCase(), b.title.toLowerCase()) : cmp(key[orderBy](a), key[orderBy](b));
        // Ties: insertion (series id) order, then occurrence date.
        return dir * primary || (a.series_id ?? a.id) - (b.series_id ?? b.id) || time(a.event_start) - time(b.event_start);
      });
    for (const e of rows) if (e.occurrence) this.entries.set(e.id, e);
    const total = Math.max(0, rows.length - (args.offset ?? 0));
    return { ids: rows.slice(offset, offset + perPage).map((e) => e.id), total, pages: Math.ceil(total / perPage) };
  }

  /** Active forms (definitions only; notification settings are not publicly readable). */
  forms(): Promise<FormRow[]> {
    this.formsCache ??= (async () => {
      const { data, error } = await this.db.from('forms').select('id, title, definition, is_active').eq('is_active', true).order('id');
      if (error) throw error;
      return (data ?? []) as FormRow[];
    })();
    return this.formsCache;
  }
}
