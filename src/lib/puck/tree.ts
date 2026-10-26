// Walking and changing a page's blocks: Puck items with their inner blocks in `props.children`, in the
// page's content and in a template's other content areas (root props `area-<name>`).
import type { PuckItem } from './types';

/** Every block, depth first (a block before the blocks inside it). */
export function eachBlock(items: PuckItem[] | undefined, fn: (item: PuckItem) => void): void {
  for (const i of items ?? []) {
    fn(i);
    eachBlock(i.props.children, fn);
  }
}

/** A copy with each block replaced by `fn`'s result (applied before the blocks inside it). */
export function mapBlocks(items: PuckItem[], fn: (item: PuckItem) => PuckItem): PuckItem[] {
  return items.map((i) => {
    const next = fn(i);
    return next.props.children ? { ...next, props: { ...next.props, children: mapBlocks(next.props.children, fn) } } : next;
  });
}

/** Find a block (and the top-level block containing it) in a list of blocks. */
export function findBlock(items: PuckItem[], id: string): { item: PuckItem; top: PuckItem } | null {
  const search = (list: PuckItem[] | undefined, top: PuckItem | null): { item: PuckItem; top: PuckItem } | null => {
    for (const i of list ?? []) {
      const t = top ?? i;
      if (i.props.id === id) return { item: i, top: t };
      const hit = search(i.props.children, t);
      if (hit) return hit;
    }
    return null;
  };
  return search(items, null);
}

/** Replace one block (anywhere in the tree) with a list of blocks. */
export function replaceBlock(items: PuckItem[], id: string, next: PuckItem[]): PuckItem[] {
  return items.flatMap((i) => {
    if (i.props.id === id) return next;
    if (i.props.children) return [{ ...i, props: { ...i.props, children: replaceBlock(i.props.children, id, next) } } as PuckItem];
    return [i];
  });
}

/** A page document: its blocks, and a template's other content areas as root props. */
interface Doc {
  content: unknown;
  root?: { props?: Record<string, unknown> } & Record<string, unknown>;
}
const areaLists = (doc: Doc) => Object.entries(doc.root?.props ?? {}).filter(([k, v]) => k.startsWith('area-') && Array.isArray(v)) as [string, PuckItem[]][];

/** A block anywhere in a page document, and the top-level block of its list containing it. */
export function locateInDoc(doc: Doc, id: string): { item: PuckItem; top: PuckItem } | null {
  for (const list of [doc.content as PuckItem[], ...areaLists(doc).map(([, v]) => v)]) {
    const hit = findBlock(list ?? [], id);
    if (hit) return hit;
  }
  return null;
}

/** A block anywhere in a page document. */
export function findInDoc(doc: Doc, id: string): PuckItem | null {
  return locateInDoc(doc, id)?.item ?? null;
}

/** A page document with one block (anywhere in it) replaced by a list of blocks. */
export function replaceInDoc<D extends Doc>(doc: D, id: string, next: PuckItem[]): D {
  const props = { ...(doc.root?.props ?? {}) };
  for (const [k, v] of areaLists(doc)) props[k] = replaceBlock(v, id, next);
  return { ...doc, root: { ...doc.root, props }, content: replaceBlock((doc.content ?? []) as PuckItem[], id, next) };
}
