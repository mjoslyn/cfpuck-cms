// The Hero's and Cover's overlay options, and the Hero's, Cover's and Image's focal points per screen size
// (src/render/c/content.ts).
import { describe, expect, it } from 'vitest';
import { cover, hero, image } from '../src/render/c/content';

const env = { ctx: { loader: { media: new Map([[7, { id: 7, path: '2026/10/a.jpg', mime_type: 'image/jpeg', width: 2000, height: 1200, focal_point: { x: 0.2, y: 0.3 }, sizes: {} }]]) } } } as any;
const render = (attrs: Record<string, unknown>) => hero({ type: 'hero', attrs: { title: 'Hello', ...attrs }, id: 'h' } as any, env, (() => '') as any);

describe('hero', () => {
  it('keeps the medium overlay, darkest at the bottom, by default', () => {
    const html = render({ src: '/media/a.jpg' });
    expect(html).toMatch(/class="c-hero is-screen[^"]*"/);
    expect(html).not.toContain('is-shade-');
  });

  it('adds the overlay options as classes, ignoring unknown values', () => {
    expect(render({ overlay: 'strong', overlayFrom: 'left' })).toMatch(/c-hero is-screen is-shade-strong is-shade-left/);
    expect(render({ overlay: 'none' })).toContain('is-shade-none');
    expect(render({ overlay: 'pitch-black', overlayFrom: 'x' })).not.toContain('is-shade-');
  });

  it('gives each screen size its focal point, the image\'s own for desktop when the block has none', () => {
    const own = render({ mediaId: 7 });
    expect(own).toContain('--focal:20% 30%');
    expect(own).toContain('object-position:var(--focal-at)');
    const set = render({ mediaId: 7, focal: { x: 0.5, y: 0.5 }, focalTablet: { x: 0.7, y: 0.2 }, focalPhone: { x: 1.4, y: 'a' } });
    expect(set).toContain('--focal:50% 50%');
    expect(set).toContain('--focal-tablet:70% 20%');
    expect(set).toContain('--focal-phone:20% 30%');
  });

  it('leaves the image alone when nothing sets a focal point', () => {
    expect(render({ src: '/media/a.jpg' })).not.toContain('--focal-at');
  });

  it('gives an Image block its own points per screen size, falling back to the image\'s', () => {
    const img = (attrs: Record<string, unknown>) => image({ type: 'image', attrs: { mediaId: 7, aspectRatio: '16/9', ...attrs }, id: 'i' } as any, env, (() => '') as any);
    expect(img({})).not.toContain('--focal');
    const html = img({ focalPhone: { x: 0.9, y: 0.1 } });
    expect(html).toContain('--focal:20% 30%');
    expect(html).toContain('--focal-tablet:20% 30%');
    expect(html).toContain('--focal-phone:90% 10%');
    expect(html).toContain('object-position:var(--focal-at)');
  });

  it('gives a Cover a gradient overlay and focal points per screen size', () => {
    const c = (attrs: Record<string, unknown>) => cover({ type: 'cover', attrs: { mediaId: 7, ...attrs }, id: 'c' } as any, env, (() => '') as any);
    const plain = c({ overlay: 'var(--color-dark)' });
    expect(plain).toContain('opacity:0.5;background-color:var(--color-dark)');
    expect(plain).toContain('--focal:20% 30%');
    const graded = c({ overlayStyle: 'left', overlay: '#123456', focalPhone: { x: 0.8, y: 0.5 } });
    expect(graded).toContain('opacity:0.8;background:linear-gradient(to right, #123456 0%, color-mix(in srgb, #123456 55%, transparent) 50%, transparent 100%)');
    expect(graded).toContain('--focal-phone:80% 50%');
    expect(c({ overlayStyle: 'diagonal' })).not.toContain('linear-gradient');
  });
});
