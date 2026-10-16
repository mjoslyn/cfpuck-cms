// Mailing segments: saved rules that pick some of the people on a campaign's lists (members or not).
// Each rule is one condition; a segment matches when all of them do, or any (`match`). The database
// evaluates them (mail_rule and mail_segment_match in supabase/migrations/*_mailing_segments.sql); this
// is their shape, cleaning and wording. Safe in the browser.

export type RuleType = 'list' | 'tag' | 'field' | 'member' | 'joined' | 'opened' | 'clicked' | 'source';

export interface Rule {
  type: RuleType;
  /** The rule turned round ("isn't on", "hasn't opened"...). */
  not?: boolean;
  lists?: number[];
  tags?: string[];
  key?: string;
  op?: 'set' | 'equals' | 'contains';
  value?: string;
  levels?: string[];
  days?: number;
}

export interface SegmentRules {
  match: 'all' | 'any';
  rules: Rule[];
}

/** A segment (table mail_segments). */
export interface Segment {
  id: number;
  name: string;
  description: string;
  rules: SegmentRules;
  updated_at?: string;
}

/** Each rule type's wording, both ways round. `members`: offered only while Members is on. */
export const RULE_TYPES: { type: RuleType; label: string; yes: string; no: string; members?: boolean }[] = [
  { type: 'list', label: 'On a list', yes: 'is on', no: 'isn’t on' },
  { type: 'tag', label: 'Tagged', yes: 'is tagged', no: 'isn’t tagged' },
  { type: 'field', label: 'A field', yes: 'has', no: 'doesn’t have' },
  { type: 'member', label: 'A member', yes: 'is a member', no: 'isn’t a member', members: true },
  { type: 'joined', label: 'Signed up', yes: 'signed up in the last', no: 'signed up more than' },
  { type: 'opened', label: 'Opened an email', yes: 'opened an email in the last', no: 'hasn’t opened an email in the last' },
  { type: 'clicked', label: 'Clicked a link', yes: 'clicked a link in the last', no: 'hasn’t clicked a link in the last' },
  { type: 'source', label: 'Signed up from', yes: 'signed up from', no: 'didn’t sign up from' },
];

/** A tag as stored: lowercased, letters, digits, spaces and dashes, at most 40 characters. */
export const cleanTag = (v: unknown) =>
  String(v ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);

/** Tags from a list or a comma- or semicolon-separated string, cleaned and without repeats (at most 30). */
export function cleanTags(v: unknown): string[] {
  const list = Array.isArray(v) ? v : String(v ?? '').split(/[,;]/);
  return [...new Set(list.map(cleanTag).filter(Boolean))].slice(0, 30);
}

/** A field's key as stored in a contact's attributes: lowercased, letters, digits and underscores. */
export const fieldKey = (v: unknown) =>
  String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : []);
const days = (v: unknown) => Math.min(3650, Math.max(1, Math.round(Number(v)) || 30));

/** One rule as stored, or null when it says nothing (a list rule with no lists...). */
export function cleanRule(v: any): Rule | null {
  const type = RULE_TYPES.find((t) => t.type === v?.type)?.type;
  if (!type) return null;
  const not = v.not === true ? { not: true } : {};
  switch (type) {
    case 'list': {
      const lists = ids(v.lists);
      return lists.length ? { type, lists, ...not } : null;
    }
    case 'tag': {
      const tags = cleanTags(v.tags);
      return tags.length ? { type, tags, ...not } : null;
    }
    case 'field': {
      const key = fieldKey(v.key);
      const op = v.op === 'equals' || v.op === 'contains' ? v.op : 'set';
      if (!key) return null;
      return { type, key, op, ...(op === 'set' ? {} : { value: String(v.value ?? '').slice(0, 200) }), ...not };
    }
    case 'member':
      return { type, levels: Array.isArray(v.levels) ? v.levels.filter((l: unknown) => typeof l === 'string' && l).slice(0, 20) : [], ...not };
    case 'joined':
    case 'opened':
    case 'clicked':
      return { type, days: days(v.days), ...not };
    case 'source': {
      const value = String(v.value ?? '').trim().slice(0, 100);
      return value ? { type, value, ...not } : null;
    }
  }
}

/** A segment's rules as stored (at most 20). */
export function cleanRules(v: any): SegmentRules {
  const rules = (Array.isArray(v?.rules) ? v.rules : []).map(cleanRule).filter((r: Rule | null): r is Rule => !!r).slice(0, 20);
  return { match: v?.match === 'any' ? 'any' : 'all', rules };
}

/** A rule in words ("is tagged farm or vip"), with list and level names. */
export function describeRule(r: Rule, names: { lists?: Map<number, string>; levels?: Map<string, string> } = {}): string {
  const t = RULE_TYPES.find((x) => x.type === r.type)!;
  const verb = r.not ? t.no : t.yes;
  const or = (list: string[]) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}` : (list[0] ?? ''));
  switch (r.type) {
    case 'list':
      return `${verb} ${or((r.lists ?? []).map((id) => names.lists?.get(id) ?? `list ${id}`))}`;
    case 'tag':
      return `${verb} ${or(r.tags ?? [])}`;
    case 'field':
      return r.op === 'set' ? `${verb} a ${r.key}` : `${verb} ${r.key} ${r.op === 'equals' ? 'equal to' : 'containing'} “${r.value}”`;
    case 'member':
      return r.levels?.length ? `${verb} (${or(r.levels.map((l) => names.levels?.get(l) ?? l))})` : verb;
    case 'joined':
      return r.not ? `${verb} ${r.days} days ago` : `${verb} ${r.days} days`;
    case 'opened':
    case 'clicked':
      return `${verb} ${r.days} days`;
    case 'source':
      return `${verb} “${r.value}”`;
  }
}

/** A segment's rules in words: "Everyone", or each rule joined by and/or. */
export function describeSegment(s: SegmentRules, names: Parameters<typeof describeRule>[1] = {}): string {
  if (!s.rules.length) return 'Everyone on the campaign’s lists';
  return s.rules.map((r) => describeRule(r, names)).join(s.match === 'any' ? ', or ' : ', and ');
}
