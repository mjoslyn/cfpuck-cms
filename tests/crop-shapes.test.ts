// The media library's crop previews: each shape's ratio as people write it, and whether an image is
// too small to fill it sharply (src/lib/media/focal.ts).
import { describe, expect, it } from 'vitest';
import { SHAPES, ratioLabel, smallFor } from '../src/lib/media/focal';

const shape = (key: string) => SHAPES.find((s) => s.key === key)!;

describe('crop shapes', () => {
  it('writes ratios as 16:9', () => {
    expect(SHAPES.map((s) => ratioLabel(s.key))).toEqual(['1:1', '16:9', '4:3', '3:4']);
  });

  it('says when the crop would come out smaller than its best size', () => {
    // A 1600 x 1067 photo: wide enough for every shape but portrait (800 wide once cropped).
    expect(SHAPES.filter((s) => smallFor(s, 1600, 1067)).map((s) => s.name)).toEqual(['Portrait']);
    expect(smallFor(shape('16/9'), 1200, 800)).toBe(true);
    expect(smallFor(shape('1/1'), null, null)).toBe(false);
  });
});
