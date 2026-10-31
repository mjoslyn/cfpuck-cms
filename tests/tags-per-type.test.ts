// Tags per type (Settings > Types, settings.site.tags_off): every type with entries takes tags until
// they're turned off for it; globals never do.
import { describe, expect, it } from 'vitest';
import { tagsOffFrom, tagsOn } from '../src/lib/templates';

describe('tags per type', () => {
  it('are on for every type until turned off, never for globals', () => {
    expect(tagsOn(undefined, 'post')).toBe(true);
    expect(tagsOn({}, 'page')).toBe(true);
    expect(tagsOn({ tags_off: ['page'] }, 'page')).toBe(false);
    expect(tagsOn({ tags_off: ['page'] }, 'post')).toBe(true);
    expect(tagsOn({}, 'global')).toBe(false);
    expect(tagsOn({ tags_off: 'page' }, 'page')).toBe(true);
  });

  it('saves only known types that take tags', () => {
    const types = ['page', 'post', 'global'];
    expect(tagsOffFrom(['page', 'nope', 'global'], types)).toEqual(['page']);
    expect(tagsOffFrom([], types)).toBeUndefined();
    expect(tagsOffFrom('page', types)).toBeUndefined();
  });
});
