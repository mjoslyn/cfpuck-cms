// Compose for terms, taxonomies and type listing pages (nothing is saved: the screen fills
// its form for review).
// POST { taxonomy, id, notes? }: a term's description, search title and meta description, and the
//   taxonomy's fields that have a `compose` hint, from the term's name, its parent, what it has now and
//   the entries filed under it.
// POST { taxonomy, notes? } (no id): the taxonomy's default search title and meta description for its
//   term pages, with {term} where each term's name goes.
// POST { type, notes? }: the search title and meta description of the type's listing page, from what
//   it lists.
import type { APIRoute } from 'astro';
import { ARCHIVE_PATHS, isTaxonomy, taxonomyLabel, taxonomySingular, typeDef, typeLabel } from '../../../lib/site';
import { SEO_LIMITS, summary } from '../../../lib/seo';
import { termFieldsFor } from '../../../lib/page-meta';
import type { FieldDef } from '../../../lib/site/types';
import { QuickError, quickAsk } from '../../../lib/compose/quick';

/** The JSON schema for a field Claude may fill (those with a `compose` hint and a plain value). */
function fieldSchema(f: FieldDef): Record<string, unknown> | null {
  if (!('compose' in f) || !f.compose) return null;
  const description = `${f.label}: ${f.compose}`;
  if (f.type === 'select') return { type: 'string', enum: f.options.map(([v]) => v), description };
  if (f.type === 'bool') return { type: 'boolean', description };
  if (f.type === 'number') return { type: 'number', description };
  if (['text', 'url', 'email', 'textarea', 'html'].includes(f.type)) return { type: 'string', description: `${description}. Empty string if the facts don't say.` };
  return null;
}

const SEO_PROPS = {
  seo_title: { type: 'string', description: `30 to ${SEO_LIMITS.title} characters, the subject first; no site name (it is added).` },
  seo_description: { type: 'string', description: '120 to 155 characters: what the page offers and why to visit.' },
};

export const POST: APIRoute = async ({ request, locals }) => {
  const body = await request.json().catch(() => ({}));
  const notes = String(body.notes ?? '').slice(0, 4000).trim();
  // A type's listing page.
  if (body.type) {
    const type = String(body.type);
    const def = typeDef(type);
    if (!def || !ARCHIVE_PATHS[type]) return new Response('That type has no listing page.', { status: 400 });
    try {
      const { data: entries } = await locals.db.from('entries').select('title, excerpt').eq('type', type).eq('status', 'publish').order('published_at', { ascending: false }).limit(20);
      const out = await quickAsk<{ seo_title?: string; seo_description?: string }>(
        `You write the search title and meta description of the "${def.label}" listing page (${ARCHIVE_PATHS[type]}): the page listing every ${def.singular.toLowerCase()} on the site${def.describe ? ` (${def.describe})` : ''}.`,
        { name: 'listing', description: 'The listing page\'s search title and meta description.', input_schema: { type: 'object', required: ['seo_title', 'seo_description'], properties: SEO_PROPS } },
        `Some of what it lists:\n${(entries ?? []).map((e) => `- ${summary(e.title, 120)}${e.excerpt ? ` — ${summary(e.excerpt, 160)}` : ''}`).join('\n') || '(nothing yet)'}${notes ? `\n\nNotes from the editor:\n${notes}` : ''}`,
      );
      return Response.json({ title: out.seo_title?.trim() ?? '', description: out.seo_description?.trim() ?? '' });
    } catch (e) {
      return new Response((e as Error).message, { status: e instanceof QuickError ? e.status : 502 });
    }
  }
  const taxonomy = String(body.taxonomy ?? '');
  if (!isTaxonomy(taxonomy)) return new Response('Unknown taxonomy.', { status: 400 });
  const one = taxonomySingular(taxonomy).toLowerCase();
  const db = locals.db;
  try {
    // A taxonomy: patterns for all its term pages.
    if (!body.id) {
      const { data: terms } = await db.from('terms').select('name').eq('taxonomy', taxonomy).order('sort').order('name').limit(40);
      const out = await quickAsk<{ title_pattern?: string; description_pattern?: string }>(
        `You write the default search title and meta description for every "${taxonomyLabel(taxonomy)}" page: one page per ${one}, listing what is filed under it. Write each as a pattern with {term} exactly where the ${one}'s name goes, so it reads well for any of them.`,
        {
          name: 'patterns',
          description: 'The default search title and meta description, with {term} for the name.',
          input_schema: {
            type: 'object',
            required: ['title_pattern', 'description_pattern'],
            properties: {
              title_pattern: { type: 'string', description: `Contains {term}. ${SEO_PROPS.seo_title.description}` },
              description_pattern: { type: 'string', description: `Contains {term}. ${SEO_PROPS.seo_description.description}` },
            },
          },
        },
        `The ${taxonomyLabel(taxonomy).toLowerCase()} include: ${(terms ?? []).map((t) => summary(t.name, 80)).join(', ') || '(none yet)'}.${notes ? `\n\nNotes from the editor:\n${notes}` : ''}`,
      );
      return Response.json({ title: out.title_pattern?.trim() ?? '', description: out.description_pattern?.trim() ?? '' });
    }

    // A term.
    const { data: term, error } = await db.from('terms').select('id, name, description, parent_id, fields').eq('id', Number(body.id)).eq('taxonomy', taxonomy).maybeSingle();
    if (error) return new Response(error.message, { status: 400 });
    if (!term) return new Response('That term no longer exists.', { status: 404 });
    const parent = term.parent_id ? (await db.from('terms').select('name').eq('id', term.parent_id).maybeSingle()).data?.name : null;
    const { data: links } = await db.from('entry_terms').select('entries!inner(type, title, excerpt, status)').eq('term_id', term.id).eq('entries.status', 'publish').limit(30);
    const entries = (links ?? []).map((l: any) => l.entries).filter(Boolean);
    const composable = termFieldsFor(taxonomy)
      .map((f) => [f, fieldSchema(f)] as const)
      .filter((x): x is readonly [FieldDef, Record<string, unknown>] => !!x[1]);
    const current = { ...(body.current ?? {}) } as { description?: string };
    const page = [
      `The ${one} "${summary(term.name, 200)}"${parent ? `, under "${summary(parent, 200)}"` : ''}.`,
      current.description || term.description ? `Its description now: ${summary(current.description || term.description, 1000)}` : '',
      entries.length
        ? `Filed under it (${entries.length}${entries.length === 30 ? ' or more' : ''}):\n${entries.map((e: any) => `- ${typeLabel(e.type)}: ${summary(e.title, 120)}${e.excerpt ? ` — ${summary(e.excerpt, 200)}` : ''}`).join('\n')}`
        : 'Nothing is filed under it yet.',
      notes ? `Notes from the editor:\n${notes}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const out = await quickAsk<{ description?: string; seo_title?: string; seo_description?: string; fields?: Record<string, unknown> }>(
      `You write the page for one ${one} of the site: a short description shown at the top of its page (2 or 3 sentences, plain text, saying what visitors find there), its search title and meta description${composable.length ? ', and its fields' : ''}.`,
      {
        name: 'term',
        description: `The ${one}'s description, SEO${composable.length ? ' and fields' : ''}.`,
        input_schema: {
          type: 'object',
          required: ['description', 'seo_title', 'seo_description', ...(composable.length ? ['fields'] : [])],
          properties: {
            description: { type: 'string', description: '2 or 3 sentences, plain text.' },
            ...SEO_PROPS,
            ...(composable.length
              ? { fields: { type: 'object', required: composable.map(([f]) => f.key), properties: Object.fromEntries(composable.map(([f, s]) => [f.key, s])) } }
              : {}),
          },
        },
      },
      page,
      1200,
    );
    const fields = Object.fromEntries(composable.map(([f]) => [f.key, out.fields?.[f.key]]).filter(([, v]) => v !== undefined && v !== ''));
    return Response.json({ description: out.description?.trim() ?? '', seo: { title: out.seo_title?.trim() ?? '', description: out.seo_description?.trim() ?? '' }, fields });
  } catch (e) {
    return new Response((e as Error).message, { status: e instanceof QuickError ? e.status : 502 });
  }
};
