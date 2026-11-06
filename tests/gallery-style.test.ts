// A gallery's look and its slider's options (src/render/c/content.ts galleryOf): classes and custom
// properties from known values only, colours checked, the autoplay interval kept to 2-20 seconds.
import { describe, expect, it } from 'vitest';
import { gallery, videoGallery } from '../src/render/c/content';

const env = { ctx: { loader: { media: new Map() } } } as any;
const kids = (() => '<figure class="c-image"><img src="/media/a.jpg" alt="" /></figure>') as any;
const render = (attrs: Record<string, unknown>, r = gallery) => r({ type: 'gallery', attrs, id: 'g' } as any, env, kids);

describe('gallery style', () => {
  it('adds nothing by default', () => {
    const html = render({});
    expect(html).toMatch(/class="c-gallery is-cropped"/);
    expect(html).not.toContain('--gallery-radius');
  });

  it('sets corners, item captions and hover from known values only', () => {
    const html = render({ radius: 'medium', itemCaptions: 'over', hover: 'zoom' });
    expect(html).toContain('has-radius has-captions-over has-hover-zoom');
    expect(html).toContain('--gallery-radius:8px');
    const odd = render({ radius: '99px', itemCaptions: 'sideways', hover: 'spin' });
    expect(odd).not.toMatch(/has-(radius|captions|hover)/);
  });

  it('styles a slider: arrows, their place and colours, dots, peek and the interval', () => {
    const html = render({ display: 'slider', arrows: 'square', arrowPosition: 'below', arrowBg: 'var(--color-accent)', arrowColor: '#fff', dots: true, peek: true, autoplay: true, interval: 60 });
    expect(html).toContain('is-slider is-cropped has-arrows-square has-arrows-below has-dots has-peek');
    expect(html).toContain('--gallery-arrow-bg:var(--color-accent)');
    expect(html).toContain('--gallery-arrow-color:#fff');
    expect(html).toContain('class="c-gallery__dots"');
    expect(html).toContain('data-autoplay="20"');
    expect(render({ display: 'slider', autoplay: true })).toContain('data-autoplay="5"');
  });

  it('leaves out arrows set to none, and colours that are not colours', () => {
    const html = render({ display: 'slider', arrows: 'none', arrowPosition: 'outside', arrowBg: 'red;background:url(x)' });
    expect(html).not.toContain('c-gallery__prev');
    expect(html).not.toContain('has-arrows-outside');
    expect(html).not.toContain('--gallery-arrow-bg');
  });

  it('ignores slider options on a grid', () => {
    expect(render({ dots: true, peek: true, arrows: 'plain' })).not.toMatch(/has-(dots|peek|arrows)/);
    expect(render({ display: 'slider', dots: true }, videoGallery)).toContain('has-dots');
  });
});
