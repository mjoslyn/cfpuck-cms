import { describe, expect, it } from 'vitest';
import { moveItem } from '../src/lib/admin/move-item';

describe('moveItem (reordering hand-picked entries)', () => {
  it('moves an item up and down', () => {
    expect(moveItem([1, 2, 3], 1, -1)).toEqual([2, 1, 3]);
    expect(moveItem([1, 2, 3], 1, 1)).toEqual([1, 3, 2]);
  });
  it('leaves the list as it is at either end', () => {
    const list = [1, 2, 3];
    expect(moveItem(list, 0, -1)).toBe(list);
    expect(moveItem(list, 2, 1)).toBe(list);
  });
  it('does not change the list it was given', () => {
    const list = [1, 2, 3];
    moveItem(list, 0, 1);
    expect(list).toEqual([1, 2, 3]);
  });
});
