// Alt text written by Claude from the image itself (the media library's Generate): the image as a
// JPEG (imageForClaude) with its file name, title and caption, through quickAsk. Nothing is saved
// until the editor saves the form.
import type { Media } from '../types';
import { imageForClaude } from '../compose/materials';
import { quickAsk } from '../compose/quick';
import type { MediaStore } from './process';
import { ALT_MAX, altContext } from './alt-text';

export async function describeImage(store: MediaStore, m: Media): Promise<string> {
  const data = await imageForClaude(store, m);
  const out = await quickAsk<{ alt?: string }>(
    'You write alt text for images on the site: what someone who can\'t see the image needs to know, in one plain sentence. Describe what matters (who or what, doing what, where), not colours or composition unless they matter. Don\'t start with "Image of" or "Photo of". Name people or places only when the title or caption names them; otherwise describe them. If the image is mostly text (a flyer, a sign), give the text\'s gist. If it is purely decorative, say so in a few words.',
    { name: 'alt_text', description: 'The alt text.', input_schema: { type: 'object', required: ['alt'], properties: { alt: { type: 'string', description: `At most ${ALT_MAX} characters, no quotation marks around it.` } } } },
    [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
      { type: 'text', text: altContext(m) },
    ],
    300,
  );
  return (out.alt ?? '').trim().replace(/^["']|["']$/g, '');
}
