import type { APIRoute } from 'astro';
import { ARCHIVE_PATHS, CODE_TYPES, TAXONOMY_BASES, TYPE_BASES } from '../../../lib/site';
import { refreshSiteTimezone } from '../../../lib/site/timezone';
import { baseProblem, cleanBase, taxonomyName } from '../../../lib/site/taxonomy-settings';
import { RESERVED_TYPES, madeTypesFrom, type MadeType } from '../../../lib/site/type-settings';

/**
 * Content types an admin makes (Settings > Types, admins only; JSON), kept in settings.site.types:
 * { action: 'save', type?, label, singular, base, archive, record, describe, order, fields } makes one
 * (its name from the singular name) or changes one made before; { action: 'delete', type } deletes one
 * no entry uses. The site's code's types can't be changed here. A type's address or listing page that
 * moves leaves a redirect from the old one.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const db = locals.db;
  const body = (await request.json().catch(() => ({}))) as Record<string, any>;
  const fail = (message: string, status = 400) => Response.json({ error: message }, { status });

  const { data: row, error: readErr } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
  if (readErr) return fail(readErr.message);
  const current = (row?.value ?? {}) as Record<string, any>;
  const codeNames = CODE_TYPES.map((t) => t.type);
  const made = madeTypesFrom(current.types, codeNames);
  const save = async (types: MadeType[]) => {
    const { error } = await db.from('settings').upsert([{ key: 'site', value: { ...current, types } }], { onConflict: 'key' });
    if (!error) await refreshSiteTimezone(db, true);
    return error;
  };
  const name = String(body.type ?? '');
  if (codeNames.includes(name)) return fail('This type is defined in the site’s code; change it there.');

  if (body.action === 'delete') {
    const mine = made.find((t) => t.type === name);
    if (!mine) return fail('That type no longer exists.', 404);
    const { count } = await db.from('entries').select('id', { count: 'exact', head: true }).eq('type', name);
    if (count) return fail(`${count} ${count === 1 ? 'entry is' : 'entries are'} still ${mine.label.toLowerCase()} (the trash included). Delete them first.`);
    const error = await save(made.filter((t) => t.type !== name));
    return error ? fail(error.message) : Response.json({ ok: true });
  }

  if (body.action !== 'save') return fail('Unknown action.');
  const before = made.find((t) => t.type === name);
  if (name && !before) return fail('That type no longer exists.', 404);
  let type = name;
  if (!before) {
    const stem = taxonomyName(String(body.singular || body.label || '')) || 'item';
    type = stem;
    for (let n = 2; codeNames.includes(type) || RESERVED_TYPES.includes(type) || made.some((t) => t.type === type); n++) type = `${stem.slice(0, 28)}_${n}`;
  }
  const [next] = madeTypesFrom([{ ...body, type }], codeNames);
  if (!next) return fail('Give the type a name.');
  // Its addresses can't be another type's, a taxonomy's or one of the site's own routes.
  const used = [
    ...Object.entries(TYPE_BASES).filter(([t]) => t !== type).map(([, b]) => cleanBase(b)),
    ...Object.entries(ARCHIVE_PATHS).filter(([t]) => t !== type).map(([, p]) => cleanBase(p)),
    ...Object.values(TAXONOMY_BASES).map(cleanBase),
  ];
  for (const [what, value] of [['address', next.base], ['listing page', next.archive]] as const) {
    const problem = value ? baseProblem(value, used) : null;
    if (problem) return fail(`Its ${what}: ${problem}`);
  }
  if (next.base && next.base === next.archive) return fail('Its listing page can’t be the address its entries start with; leave one empty or change it.');
  const error = await save(before ? made.map((t) => (t.type === type ? next : t)) : [...made, next]);
  if (error) return fail(error.message);

  // Moved addresses keep working: the old ones redirect to the new.
  const moved: { from_path: string; to_url: string }[] = [];
  if (before?.base && next.base && before.base !== next.base) moved.push({ from_path: `/${before.base}/*`, to_url: `/${next.base}/*` });
  if (before?.archive && next.archive && before.archive !== next.archive) moved.push({ from_path: `/${before.archive}/`, to_url: `/${next.archive}/` });
  if (moved.length) await db.from('redirects').insert(moved.map((m) => ({ ...m, status: 301, note: `${next.label}: moved in Settings > Types` })));
  return Response.json({ ok: true, type: next });
};
