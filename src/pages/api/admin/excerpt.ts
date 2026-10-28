// Suggest an entry's excerpt (the Excerpt's Compose): POST { type, title, text } with the
// page's current text; answers { excerpt }. The excerpt is the summary listings and search results show.
import type { APIRoute } from 'astro';
import { typeLabel } from '../../../lib/site';
import { QuickError, quickAsk } from '../../../lib/compose/quick';

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const title = String(body.title ?? '').slice(0, 300);
  const text = String(body.text ?? '').slice(0, 12000);
  if (!title && !text) return new Response('The page has no title or text yet.', { status: 400 });
  try {
    const out = await quickAsk<{ excerpt?: string }>(
      "You write excerpts: the short summary shown with a page in listings, cards and search results. Say what the page is and why it's worth reading, in the page's own voice; don't start with its title or with \"This page\".",
      {
        name: 'excerpt',
        description: 'The excerpt.',
        input_schema: { type: 'object', required: ['excerpt'], properties: { excerpt: { type: 'string', description: 'One or two sentences, plain text, no more than 200 characters (a card shows about that much).' } } },
      },
      `A ${typeLabel(String(body.type ?? 'page')).toLowerCase()} titled "${title}".\n\nIts text:\n${text || '(none yet)'}`,
    );
    if (!out.excerpt?.trim()) return new Response('No suggestion came back.', { status: 502 });
    return Response.json({ excerpt: out.excerpt.trim() });
  } catch (e) {
    return new Response((e as Error).message, { status: e instanceof QuickError ? e.status : 502 });
  }
};
