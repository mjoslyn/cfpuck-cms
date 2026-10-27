// The Featured image block's height: presets, Auto, custom, and the card height in a collection's
// cards (src/lib/content/image-height.ts, src/render/c/entry.ts).
import { describe, expect, it } from 'vitest';
import { entryImage } from '../src/render/c/entry';
import { CARD_IMAGE_HEIGHT, entryImageHeight, heightChoice } from '../src/lib/content/image-height';

const media = { id: 7, path: '2026/10/a.jpg', mime_type: 'image/jpeg', width: 2000, height: 1200, sizes: {} };
const post = { id: 3, type: 'post', slug: 'a', title: 'A', featured_media_id: 7, fields: {} };
const env = (inCard?: boolean) => ({ ctx: { loader: { media: new Map([[7, media]]), terms: new Map() }, settings: { site: {} } }, post, inCard }) as any;
const render = (attrs: Record<string, unknown>, inCard?: boolean) => entryImage({ type: 'entry-image', attrs, id: 'e' } as any, env(inCard), (() => '') as any);

describe('featured image height', () => {
  it('gives a card the card height when the block sets no height, ratio, fit or cover', () => {
    expect(entryImageHeight({}, true)).toBe(CARD_IMAGE_HEIGHT);
    expect(entryImageHeight({ aspectRatio: 'auto' }, true)).toBe(CARD_IMAGE_HEIGHT);
    expect(entryImageHeight({ aspectRatio: '4/3' }, true)).toBeUndefined();
    expect(entryImageHeight({ scale: 'cover' }, true)).toBeUndefined();
    expect(entryImageHeight({ cover: true }, true)).toBeUndefined();
    expect(entryImageHeight({}, false)).toBeUndefined();
  });

  it('takes the block\'s height, and Auto as the image\'s own', () => {
    expect(entryImageHeight({ height: '320px' }, true)).toBe('320px');
    expect(entryImageHeight({ height: '20rem' })).toBe('20rem');
    expect(entryImageHeight({ height: 'auto' }, true)).toBeUndefined();
  });

  it('names the picker\'s choice', () => {
    expect(heightChoice(undefined)).toBe('');
    expect(heightChoice('auto')).toBe('auto');
    expect(heightChoice('240px')).toBe('240px');
    expect(heightChoice('250px')).toBe('custom');
  });

  it('renders a card\'s image at the card height, cropped to fill the width', () => {
    const html = render({ link: true }, true);
    expect(html).toContain(`height:${CARD_IMAGE_HEIGHT}`);
    expect(html).toContain('object-fit:cover');
    expect(html).toContain('width:100%');
  });

  it('leaves the image as it is outside a card and with Auto', () => {
    for (const html of [render({}), render({ height: 'auto' }, true)]) {
      expect(html).not.toContain('height:');
      expect(html).not.toContain('object-fit');
    }
  });
});
