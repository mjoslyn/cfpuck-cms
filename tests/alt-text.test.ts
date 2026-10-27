// The media library's alt text Generate (src/lib/media/alt-text.ts, describe.ts): which files it offers
// it for, what it tells Claude besides the image, and that it leaves the page cache alone.
import { describe, expect, it } from 'vitest';
import { altContext, describable } from '../src/lib/media/alt-text';
import { changesPages } from '../src/lib/cache';

describe('alt text generation', () => {
  it('is offered for raster images only', () => {
    expect(describable({ mime_type: 'image/jpeg' })).toBe(true);
    expect(describable({ mime_type: 'image/webp' })).toBe(true);
    expect(describable({ mime_type: 'image/svg+xml' })).toBe(false);
    expect(describable({ mime_type: 'video/mp4' })).toBe(false);
  });

  it('passes on the file name, title, caption and current alt text', () => {
    expect(altContext({ path: '2026/10/market-day.jpg', title: 'Market day', caption: 'Main Street, May 4', alt: '' })).toBe('File name: market-day.jpg\nTitle: Market day\nCaption: Main Street, May 4');
    expect(altContext({ path: 'a.png', title: '', caption: '', alt: 'A dog' })).toBe('File name: a.png\nIts alt text now (improve on it): A dog');
  });

  it('leaves the page cache alone', () => {
    expect(changesPages('POST', '/api/admin/media/describe')).toBe(false);
    expect(changesPages('PUT', '/api/admin/media/5')).toBe(true);
  });
});
