import { describe, expect, it } from 'vitest';
import { ancestorsOf } from '../src/lib/puck/trail';

const zones: Record<string, string> = { section: 'root:default-zone', columns: 'section:children', column: 'columns:children', text: 'column:children' };
const zoneOf = (id: string) => zones[id];

describe('ancestorsOf', () => {
  it('lists every block a nested block sits inside, outermost first', () => {
    expect(ancestorsOf('text', zoneOf)).toEqual(['section', 'columns', 'column']);
  });
  it('is empty for a block at the top of the page', () => {
    expect(ancestorsOf('section', zoneOf)).toEqual([]);
  });
  it('stops at a block it cannot place, or a loop', () => {
    expect(ancestorsOf('missing', zoneOf)).toEqual([]);
    expect(ancestorsOf('a', (id) => (id === 'a' ? 'b:children' : 'a:children'))).toEqual(['b']);
  });
});
