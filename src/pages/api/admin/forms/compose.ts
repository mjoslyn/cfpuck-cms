// Compose for a form (the form builder): POST { brief, parts, definition, notifications } ->
// { definition, notifications?, page?, notes }. `parts`: fields, confirmation (a message) or page (a
// thank-you page), notifications. The builder applies the answer for review; nothing is saved but a
// thank-you page, made as a draft (hidden from search engines and the site's search).
import type { APIRoute } from 'astro';
import { QuickError, quickAsk } from '../../../../lib/compose/quick';
import { env } from '../../../../lib/compose/client';
import { buildPage } from '../../../../lib/compose/build';
import { applyComposed, composeSchema, composeTask, formOutline, type ComposedForm, type ComposePart } from '../../../../lib/forms/compose';
import { defaultTemplate } from '../../../../lib/email-templates';
import { renderedTitle, uniqueSlug } from '../../../../lib/admin/save';
import { slugify } from '../../../../lib/slug';
import { typeDef } from '../../../../lib/site';
import type { FormDef, Notification } from '../../../../lib/forms/types';

const PARTS: ComposePart[] = ['fields', 'confirmation', 'page', 'notifications'];

export const POST: APIRoute = async ({ request, locals }) => {
  const body = await request.json().catch(() => ({}));
  const brief = String(body.brief ?? '').slice(0, 8000).trim();
  let parts = PARTS.filter((p) => Array.isArray(body.parts) && body.parts.includes(p));
  if (parts.includes('page')) parts = parts.filter((p) => p !== 'confirmation');
  if (parts.includes('page') && !typeDef('page')) return new Response('This site has no pages to make a thank-you page with.', { status: 400 });
  const def = body.definition as FormDef | undefined;
  if (!def || !Array.isArray(def.fields) || !parts.length) return new Response('Say what to write.', { status: 400 });
  if (!brief && !def.fields.length) return new Response('Say what the form is for.', { status: 400 });
  const notifications: Notification[] = Array.isArray(body.notifications) ? body.notifications : [];
  try {
    const answer = await quickAsk<ComposedForm>(
      composeTask(parts, def),
      { name: 'form', description: 'The form as asked.', input_schema: composeSchema(parts) },
      `${formOutline(def, notifications)}${brief ? `\n\nWhat the editor wants:\n${brief}` : ''}`,
      16000,
      { model: env('ANTHROPIC_MODEL') || 'claude-sonnet-5-5', facts: 'Don\'t invent facts the editor didn\'t give (prices, dates, places, how soon someone will reply).' },
    );
    const tpl = parts.includes('notifications') ? await defaultTemplate(locals.db, 'form').catch(() => null) : null;
    const applied = applyComposed(def, notifications, answer, tpl?.design?.root?.props ?? {});
    let page: { id: number; title: string } | undefined;
    if (applied.page) {
      const slug = await uniqueSlug(locals.db, 'page', slugify(applied.page.title) || 'thank-you');
      const content = buildPage(applied.page, { images: new Map(), videos: new Map(), tags: new Map() });
      const { data, error } = await locals.db
        .from('entries')
        .insert({ type: 'page', title: applied.page.title, title_rendered: renderedTitle(applied.page.title), slug, status: 'draft', fields: { seo: { noindex: true, nosearch: true } }, content: { root: { props: {} }, content, zones: {} } })
        .select('id, title')
        .single();
      if (error) return new Response(`The thank-you page wasn’t made: ${error.message}`, { status: 400 });
      page = data as { id: number; title: string };
      applied.definition.confirmation = { ...applied.definition.confirmation!, pageId: page.id };
    }
    return Response.json({ definition: applied.definition, notifications: applied.notifications, page, notes: applied.notes });
  } catch (e) {
    return new Response((e as Error).message, { status: e instanceof QuickError ? e.status : 502 });
  }
};
