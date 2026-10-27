// Copy styles / Paste styles: a block's look onto another block; the look settings of its type only onto
// the same type; never its content; not into a linked pattern, whose styles are the pattern's.
import { describe, expect, it } from 'vitest';
import { copyStyle, pasteStyle, takesStyle } from '../src/lib/content/style-copy';

const section = { style: { background: 'var(--color-night)', padding: { top: 'var(--space-70)' } }, width: 'full', className: 'band', gap: 'var(--space-50)', anchor: 'intro' };

describe('style copy', () => {
  it('copies style and look settings, never content', () => {
    const c = copyStyle('section', { ...section, content: 'not copied' });
    expect(c).toEqual({ type: 'section', attrs: { style: section.style, width: 'full', className: 'band', gap: 'var(--space-50)' } });
  });

  it('pastes everything onto the same type, clearing what the copy lacks', () => {
    const target = { style: { color: 'red' }, justify: 'center', gap: '1rem', anchor: 'mine' };
    const out = pasteStyle('section', target, copyStyle('section', section));
    expect(out).toEqual({ style: section.style, width: 'full', className: 'band', gap: 'var(--space-50)', anchor: 'mine' });
  });

  it('pastes only the shared styles onto another type', () => {
    const text = { content: 'Hello', dropCap: true };
    const out = pasteStyle('text', text, copyStyle('section', section));
    expect(out).toEqual({ content: 'Hello', dropCap: true, style: section.style, width: 'full', className: 'band' });
  });

  it('keeps the copy apart from the block it came from', () => {
    const c = copyStyle('section', section);
    (c.attrs.style as any).background = 'changed';
    expect(section.style.background).toBe('var(--color-night)');
  });

  it("leaves linked patterns' blocks alone", () => {
    expect(takesStyle('text', { __src: 'p1' })).toBe(false);
    expect(takesStyle('pattern', { linked: true })).toBe(false);
    expect(takesStyle('pattern', { slug: 'x' })).toBe(true);
    expect(takesStyle('text', {})).toBe(true);
  });
});
