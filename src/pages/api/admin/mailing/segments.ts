// Mailing segments (the Mailing Lists screen's Segments tab and the segment editor). JSON posts { action, ... }:
// create (a form post from the list goes to its editor), save (id, segment: name, description, rules),
// delete (id; refused while a campaign or digest uses it, so no audience widens on its own), people
// (rules, lists?: who matches now, subscribed, with a count and the first 100). Editors and admins.
// Writes here don't change the site's pages.
import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../lib/db/site';
import { cleanRules } from '../../../../lib/mailing/segments';
import { audienceOfRules } from '../../../../lib/mailing/send';

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const isForm = /form/.test(request.headers.get('content-type') ?? '');
  const body: any = isForm ? Object.fromEntries((await request.formData()).entries()) : await request.json().catch(() => ({}));
  const db = locals.db;
  const fail = (msg: string, status = 400) => new Response(msg, { status });
  switch (String(body.action ?? '')) {
    case 'create': {
      const { data, error } = await db.from('mail_segments').insert({ name: 'New segment' }).select('id').single();
      if (error) return fail(error.message);
      return isForm ? redirect(`/admin/mailing-lists/segments/${data.id}/`, 303) : Response.json({ id: data.id });
    }
    case 'save': {
      const s = body.segment ?? {};
      const { data, error } = await db.from('mail_segments').update({ name: text(s.name, 100) || 'Untitled segment', description: text(s.description, 500), rules: cleanRules(s.rules) }).eq('id', Number(body.id)).select('updated_at').single();
      return error ? fail(error.message) : Response.json({ ok: true, updated_at: data.updated_at });
    }
    case 'delete': {
      const id = Number(body.id);
      const [{ data: campaigns }, { data: digests }] = await Promise.all([
        db.from('campaigns').select('name').eq('segment_id', id).limit(3),
        db.from('digests').select('name').eq('segment_id', id).limit(3),
      ]);
      const users = [...(campaigns ?? []), ...(digests ?? [])].map((x) => `“${x.name}”`);
      if (users.length) return fail(`It’s used by ${users.join(', ')}${users.length >= 3 ? ' and more' : ''}. Choose another segment there first.`);
      const { error } = await db.from('mail_segments').delete().eq('id', id);
      return error ? fail(error.message) : Response.json({ ok: true });
    }
    case 'people': {
      // Who matches now: on the lists given, else on any list. Read with the site's key (the audience
      // function isn't the API's); the editor's session above has already passed the middleware.
      const lists = Array.isArray(body.lists) && body.lists.length ? body.lists.map(Number).filter((n: number) => n > 0) : null;
      try {
        const all = await audienceOfRules(serviceClient(), { lists, rules: cleanRules(body.rules) });
        return Response.json({ count: all.length, people: all.slice(0, 100) });
      } catch (e) {
        return fail((e as Error).message);
      }
    }
  }
  return fail('Unknown action.');
};
