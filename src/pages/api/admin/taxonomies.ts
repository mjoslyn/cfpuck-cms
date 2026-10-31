import type { APIRoute } from 'astro';
import { ARCHIVE_PATHS, CODE_TAXONOMIES, TAXONOMY_BASES, TYPE_BASES, codeTypesOf, isTaxonomy, site } from '../../../lib/site';
import { refreshSiteTimezone } from '../../../lib/site/timezone';
import { baseProblem, cleanBase, madeTaxonomiesFrom, taxonomyName, taxonomyTypesFrom, type MadeTaxonomy } from '../../../lib/site/taxonomy-settings';

/**
 * Taxonomies set in the admin (Content > Taxonomies, admins only; form posts, back to the taxonomy's tab),
 * kept in the site settings: action=create (label, singular, base, flat, types[]) makes one, its name
 * made from the label; update (taxonomy, and for a made one label, singular, base, flat; types[]) saves
 * its settings, and for one of the site's own, the types added to those its code gives it; delete
 * (taxonomy, a made one only) deletes it and its terms, which entries lose.
 */
export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const db = locals.db;
  const form = await request.formData();
  const action = String(form.get('action') ?? '');
  let taxonomy = String(form.get('taxonomy') ?? '');
  const back = (key: 'error' | 'notice', msg: string, tab = taxonomy) => redirect(`/admin/?type=terms${tab ? `&taxonomy=${encodeURIComponent(tab)}` : ''}&${key}=${encodeURIComponent(msg)}`, 303);

  const { data: row, error: readErr } = await db.from('settings').select('value').eq('key', 'site').maybeSingle();
  if (readErr) return back('error', readErr.message);
  const current = (row?.value ?? {}) as Record<string, any>;
  const typeNames = site.types.filter((t) => t.type !== 'global').map((t) => t.type);
  const codeNames = CODE_TAXONOMIES.map((t) => t.name);
  const made = madeTaxonomiesFrom(current.taxonomies, typeNames, codeNames);
  const added = taxonomyTypesFrom(current.taxonomy_types, codeNames.filter((n) => n !== 'tag'), typeNames);
  const types = typeNames.filter((t) => form.getAll('types').map(String).includes(t));
  const save = async (next: { taxonomies?: MadeTaxonomy[]; taxonomy_types?: Record<string, string[]> }) => {
    const value = { ...current, taxonomies: next.taxonomies ?? made, taxonomy_types: next.taxonomy_types ?? added };
    const { error } = await db.from('settings').upsert([{ key: 'site', value }], { onConflict: 'key' });
    if (!error) await refreshSiteTimezone(db, true);
    return error;
  };
  // A made taxonomy's settings from the form, with its address checked against every other in use.
  const settingsFrom = (name: string): MadeTaxonomy | string => {
    const label = String(form.get('label') ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!label) return 'Give it a name.';
    const base = cleanBase(form.get('base'));
    const used = [
      ...Object.entries(TAXONOMY_BASES).filter(([n]) => n !== name).map(([, b]) => cleanBase(b)),
      ...Object.values(TYPE_BASES).map(cleanBase),
      ...Object.values(ARCHIVE_PATHS).map(cleanBase),
    ];
    const problem = baseProblem(base, used);
    if (problem) return problem;
    const singular = String(form.get('singular') ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    return { name, label, ...(singular ? { singular } : {}), ...(base ? { base } : {}), ...(form.get('flat') ? { flat: true } : {}), types };
  };

  if (action === 'create') {
    const label = String(form.get('label') ?? '');
    let name = taxonomyName(label) || 'taxonomy';
    for (let n = 2; isTaxonomy(name) || made.some((t) => t.name === name) || site.types.some((t) => t.type === name); n++) name = `${taxonomyName(label).slice(0, 28) || 'taxonomy'}_${n}`;
    const t = settingsFrom(name);
    if (typeof t === 'string') return back('error', t);
    const error = await save({ taxonomies: [...made, t] });
    return error ? back('error', error.message) : back('notice', `Made "${t.label}". Add its terms below.`, name);
  }

  const mine = made.find((t) => t.name === taxonomy);
  if (action === 'update' && mine) {
    const t = settingsFrom(taxonomy);
    if (typeof t === 'string') return back('error', t);
    const error = await save({ taxonomies: made.map((x) => (x.name === taxonomy ? t : x)) });
    return error ? back('error', error.message) : back('notice', `Saved "${t.label}".`);
  }
  if (action === 'update' && codeNames.includes(taxonomy) && taxonomy !== 'tag') {
    // The site's code gives it some types; the admin adds others.
    const own = codeTypesOf(taxonomy);
    const extra = types.filter((t) => !own.includes(t));
    const next = { ...added };
    if (extra.length) next[taxonomy] = extra;
    else delete next[taxonomy];
    const error = await save({ taxonomy_types: next });
    return error ? back('error', error.message) : back('notice', 'Saved its types.');
  }
  if (action === 'delete' && mine) {
    const { error: termErr } = await db.from('terms').delete().eq('taxonomy', taxonomy);
    if (termErr) return back('error', termErr.message);
    const error = await save({ taxonomies: made.filter((x) => x.name !== taxonomy) });
    return error ? back('error', error.message) : back('notice', `Deleted "${mine.label}" and its terms.`, '');
  }
  return back('error', 'That taxonomy can’t be changed here.');
};
