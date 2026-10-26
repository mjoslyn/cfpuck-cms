// Linked patterns: a pattern placed on a page that keeps the pattern's layout and style (editing the
// pattern changes every page) while each page can change its content (text, images, links). A page
// stores the reference and only the content it changed:
//   { type: 'pattern', props: { id, attrs: { slug, linked: true, overrides: { <block id>: { content: ... } } } } }
// The block ids are the pattern's own. In the editor the reference is expanded into a container of
// the pattern's blocks (attrs.expanded), each marked with the pattern block it came from (attrs.__src),
// with the content as it was expanded (attrs.__as) and the page's overrides then (attrs.__overrides);
// saving collapses it back, recording only the content the editor changed. A pattern is offered as linked when its root props say so (linked: true).
import type { PuckItem } from '../puck/types';
import { eachBlock, mapBlocks } from '../puck/tree';

export type ContentKind = 'rich' | 'text' | 'link' | 'media';
export interface ContentField {
  key: string;
  label: string;
  kind: ContentKind;
}

const f = (key: string, label: string, kind: ContentKind): ContentField => ({ key, label, kind });

/** The settings of each block that are content (a page can change them); everything else is style. */
export const CONTENT_FIELDS: Record<string, ContentField[]> = {
  text: [f('content', 'Text', 'rich')],
  heading: [f('content', 'Heading', 'rich')],
  'list-item': [f('content', 'Item', 'rich')],
  quote: [f('citation', 'Citation', 'text')],
  button: [f('text', 'Label', 'text'), f('href', 'Link', 'link')],
  image: [f('mediaId', 'Image', 'media'), f('alt', 'Alt text', 'text'), f('caption', 'Caption', 'rich'), f('href', 'Link', 'link')],
  cover: [f('mediaId', 'Image', 'media'), f('alt', 'Alt text', 'text')],
  'media-text': [f('mediaId', 'Image', 'media'), f('alt', 'Alt text', 'text')],
  hero: [
    f('mediaId', 'Image', 'media'),
    f('eyebrow', 'Eyebrow', 'text'),
    f('title', 'Title', 'text'),
    f('text', 'Text', 'rich'),
    f('primaryLabel', 'Button label', 'text'),
    f('primaryHref', 'Button link', 'link'),
    f('secondaryLabel', 'Second button label', 'text'),
    f('secondaryHref', 'Second button link', 'link'),
  ],
  embed: [f('url', 'URL', 'link')],
  video: [f('src', 'Video', 'link'), f('poster', 'Poster image', 'link')],
};

/** The attribute keys a block's content covers (a media field is its id and its URL). */
export const contentKeys = (type: string): string[] => (CONTENT_FIELDS[type] ?? []).flatMap((c) => (c.kind === 'media' ? ['mediaId', 'src'] : [c.key]));

export type Overrides = Record<string, Record<string, unknown>>;

/** Whether a pattern document is offered as linked. */
export const isLinkedPattern = (doc: { root?: { props?: Record<string, unknown> } } | null | undefined) => doc?.root?.props?.linked === true;

/** A pattern's blocks with a page's content changes applied (by the pattern's block ids). */
export function applyOverrides(items: PuckItem[], overrides: Overrides | undefined): PuckItem[] {
  if (!overrides || !Object.keys(overrides).length) return items;
  return mapBlocks(items, (i) => {
    const o = overrides[i.props.id];
    return o ? { ...i, props: { ...i.props, attrs: { ...(i.props.attrs ?? {}), ...o } } } : i;
  });
}

/** The editor's form of a linked pattern on a page: a container of its blocks, ids prefixed by the instance's. */
export function expandLinked(instance: PuckItem, patternItems: PuckItem[]): PuckItem {
  const prefix = instance.props.id;
  const mark = (list: PuckItem[]) => mapBlocks(list, (i) => ({ type: i.type, props: { ...i.props, id: `${prefix}-${i.props.id}`, attrs: { ...(i.props.attrs ?? {}), __src: i.props.id } } }));
  const { overrides, ...attrs } = instance.props.attrs ?? {};
  const shown = applyOverrides(patternItems, overrides as Overrides | undefined);
  // The content as expanded, so saving can tell the editor's changes from changes to the pattern since.
  const as: Overrides = {};
  eachBlock(shown, (i) => {
    for (const key of contentKeys(i.type)) (as[i.props.id] ??= {})[key] = (i.props.attrs as any)?.[key] ?? null;
  });
  return {
    type: 'pattern',
    props: { id: prefix, attrs: { ...attrs, linked: true, expanded: true, __as: as, ...(overrides ? { __overrides: overrides } : {}) }, children: mark(shown) },
  };
}

/** Blocks with the linked markers removed (an ordinary copy). */
export function unmark(items: PuckItem[]): PuckItem[] {
  return mapBlocks(items, (i) => {
    const { __src, ...attrs } = (i.props.attrs ?? {}) as Record<string, unknown>;
    return { ...i, props: { ...i.props, attrs } };
  });
}

const flatIds = (list: PuckItem[] | undefined, src: boolean): string[] =>
  (list ?? []).flatMap((i) => [`${i.type}:${src ? (i.props.attrs as any)?.__src : i.props.id}`, '[', ...flatIds(i.props.children, src), ']']);

/**
 * The stored form of an expanded linked pattern: the reference plus the content this page changed.
 * If its blocks no longer match the pattern's (added, removed, moved), it is kept as an ordinary copy
 * instead (`detached`).
 */
export function collapseLinked(container: PuckItem, patternItems: PuckItem[]): { item: PuckItem; detached?: PuckItem[] } {
  const children = container.props.children ?? [];
  if (flatIds(children, true).join() !== flatIds(patternItems, false).join()) return { item: container, detached: unmark(children) };
  const original = new Map<string, PuckItem>();
  eachBlock(patternItems, (i) => original.set(i.props.id, i));
  const { expanded, overrides: _old, __as, __overrides, ...attrs } = (container.props.attrs ?? {}) as Record<string, unknown>;
  const as = __as as Overrides | undefined;
  const before = (__overrides ?? {}) as Overrides;
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const overrides: Overrides = {};
  eachBlock(children, (i) => {
    const src = String((i.props.attrs as any)?.__src);
    const was = original.get(src)?.props.attrs ?? {};
    for (const key of contentKeys(i.type)) {
      let now = (i.props.attrs as any)?.[key];
      // Content the editor left as expanded keeps what the page had: its override, else the pattern as it is now.
      if (as?.[src] && key in as[src] && same(now, as[src][key])) {
        if (!(key in (before[src] ?? {}))) continue;
        now = before[src][key];
      }
      if (!same(now, (was as any)[key])) (overrides[src] ??= {})[key] = now ?? null;
    }
  });
  return {
    item: { type: 'pattern', props: { id: container.props.id, attrs: { ...attrs, linked: true, ...(Object.keys(overrides).length ? { overrides } : {}) } } },
  };
}

/** Every expanded linked pattern in a list of blocks collapsed for saving (see collapseLinked). */
export async function collapseAll(items: PuckItem[], patternItems: (slug: string) => Promise<PuckItem[] | null>): Promise<{ items: PuckItem[]; detached: number }> {
  let detached = 0;
  const walk = async (list: PuckItem[]): Promise<PuckItem[]> => {
    const out: PuckItem[] = [];
    for (const i of list) {
      if (i.type === 'pattern' && (i.props.attrs as any)?.expanded) {
        const source = await patternItems(String((i.props.attrs as any).slug));
        if (!source) {
          // The pattern is gone: keep its blocks as an ordinary copy.
          detached++;
          out.push(...unmark(i.props.children ?? []));
          continue;
        }
        const r = collapseLinked(i, source);
        if (r.detached) {
          detached++;
          out.push(...r.detached);
        } else out.push(r.item);
        continue;
      }
      out.push(i.props.children ? { ...i, props: { ...i.props, children: await walk(i.props.children) } } : i);
    }
    return out;
  };
  return { items: await walk(items), detached };
}
