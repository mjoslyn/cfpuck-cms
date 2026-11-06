import { describe, expect, it } from 'vitest';
import { MESSAGE_LIMITS, takeMaterials } from '../src/lib/compose/limits';

const form = (opts: { message?: string; docs?: number; media?: number; links?: number }) => {
  const f = new FormData();
  f.set('message', opts.message ?? 'Make a page');
  for (let i = 0; i < (opts.docs ?? 0); i++) f.append('docs', new File(['x'], `doc-${i}.txt`, { type: 'text/plain' }));
  for (let i = 0; i < (opts.media ?? 0); i++) f.append('media', String(i + 1));
  f.set('links', Array.from({ length: opts.links ?? 0 }, (_, i) => `https://example.org/${i}`).join('\n'));
  return f;
};

describe('takeMaterials', () => {
  it('keeps everything within the limits, with no notes', () => {
    const t = takeMaterials(form({ docs: 2, media: 3, links: 1 }));
    expect([t.docs.length, t.mediaIds.length, t.links.length]).toEqual([2, 3, 1]);
    expect(t.notes).toEqual([]);
  });

  it('says what it left out past each limit, instead of dropping it unseen', () => {
    const t = takeMaterials(form({ docs: MESSAGE_LIMITS.docs + 2, media: MESSAGE_LIMITS.media + 1, links: MESSAGE_LIMITS.links + 5 }));
    expect(t.docs).toHaveLength(MESSAGE_LIMITS.docs);
    expect(t.mediaIds).toHaveLength(MESSAGE_LIMITS.media);
    expect(t.links).toHaveLength(MESSAGE_LIMITS.links);
    expect(t.notes).toEqual([
      'Only the first 10 documents were added (2 left out). Send the rest in another message.',
      'Only the first 40 images and videos were added (1 left out). Send the rest in another message.',
      'Only the first 20 links were added (5 left out). Send the rest in another message.',
    ]);
  });

  it('cuts a long message and says so', () => {
    const t = takeMaterials(form({ message: 'a'.repeat(MESSAGE_LIMITS.text + 10) }));
    expect(t.message).toHaveLength(MESSAGE_LIMITS.text);
    expect(t.notes).toEqual(['Your message was cut to its first 20,000 characters. Add long text as a document instead.']);
  });

  it('ignores empty files and links that are not web addresses', () => {
    const f = form({ docs: 1 });
    f.append('docs', new File([], 'empty.txt'));
    f.set('links', 'https://example.org/a not-a-link ftp://example.org/b');
    const t = takeMaterials(f);
    expect(t.docs).toHaveLength(1);
    expect(t.links).toEqual(['https://example.org/a']);
  });
});
