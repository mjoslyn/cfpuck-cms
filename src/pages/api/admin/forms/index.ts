import type { APIRoute } from 'astro';
import { newForm, defaultNotification } from '../../../../lib/forms/defaults';
import { defaultTemplate } from '../../../../lib/email-templates';

/** Create a form: { title } -> { id }. Its notification starts from the default template for form notifications. */
export const POST: APIRoute = async ({ request, locals }) => {
  const { title } = await request.json().catch(() => ({}));
  const name = String(title || 'Untitled form').slice(0, 200);
  const tpl = await defaultTemplate(locals.db, 'form');
  const notification = { ...defaultNotification(), ...(tpl ? { design: tpl.design, ...(tpl.text ? { text: tpl.text } : {}) } : {}) };
  const { data, error } = await locals.db.from('forms').insert({ title: name, definition: {}, notifications: [notification] }).select('id').single();
  if (error) return new Response(error.message, { status: 400 });
  const { error: e2 } = await locals.db.from('forms').update({ definition: newForm(data.id, name) }).eq('id', data.id);
  if (e2) return new Response(e2.message, { status: 400 });
  return Response.json({ id: data.id });
};
