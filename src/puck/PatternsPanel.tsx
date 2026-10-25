// Left rail: the pattern library. Inserting a pattern puts a copy of its blocks on the page (after the
// section holding the selected block, or at the end), to edit like any other blocks; the pattern itself
// stays as it is. A linked pattern is placed as a reference instead: its content changes per page,
// its layout and style stay the pattern's.
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useGetPuck, type Data } from '@puckeditor/core';
import { browserClient } from '../lib/db/browser';
import { findBlock, replaceBlock } from '../lib/puck/tree';
import type { PuckItem } from '../lib/puck/types';
import { EnvContext } from './BlockView';
import { inlinePatterns, reId } from './patterns';
import { expandLinked, isLinkedPattern } from '../lib/content/linked-patterns';

interface PatternRow {
  slug: string;
  title: string;
  content: { content?: PuckItem[]; root?: { props?: Record<string, unknown> } } | null;
}

/** The page width a thumbnail shows, scaled down to the panel. */
const PAGE_WIDTH = 1280;
/** Tallest a thumbnail gets; taller patterns shrink to fit. */
const MAX_HEIGHT = 220;

/**
 * A pattern as the site shows it: its preview page in a scaled-down frame, loaded when it scrolls into
 * view, then sized to the whole pattern (up to MAX_HEIGHT; taller ones scale down further, centred).
 * Decorative (the name is next to it), so it is hidden from assistive tech and not focusable.
 */
function Thumbnail({ slug, title }: { slug: string; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [near, setNear] = useState(false);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const size = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    size.observe(el);
    const seen = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: '300px' });
    seen.observe(el);
    return () => {
      size.disconnect();
      seen.disconnect();
    };
  }, []);
  // The pattern's height once its page has loaded (same origin, so readable).
  const measure = (frame: HTMLIFrameElement) => {
    const body = frame.contentDocument?.body;
    if (body) setHeight(Math.max(1, body.scrollHeight));
  };
  const fit = width / PAGE_WIDTH;
  const scale = height ? Math.min(fit, MAX_HEIGHT / height) : fit;
  const shown = height ? Math.max(40, Math.round(height * scale)) : 120;
  return (
    <div ref={box} aria-hidden="true" className="relative overflow-hidden rounded border border-admin-ink/10 bg-admin-bg" style={{ height: shown }}>
      {near && width > 0 && (
        <iframe
          src={`/admin/pattern-preview?slug=${encodeURIComponent(slug)}`}
          title={`Preview: ${title}`}
          tabIndex={-1}
          loading="lazy"
          onLoad={(e) => measure(e.currentTarget)}
          className="pointer-events-none absolute top-0 border-0"
          style={{ left: Math.max(0, (width - PAGE_WIDTH * scale) / 2), width: PAGE_WIDTH, height: height || MAX_HEIGHT / fit, transform: `scale(${scale})`, transformOrigin: 'top left' }}
        />
      )}
    </div>
  );
}

export function PatternsPanel() {
  const env = useContext(EnvContext);
  const getPuck = useGetPuck();
  const [rows, setRows] = useState<PatternRow[] | null>(null);
  const [q, setQ] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    browserClient()
      .from('templates')
      .select('slug, title, content')
      .eq('kind', 'pattern')
      .order('title')
      .then(({ data }) => setRows(((data ?? []) as PatternRow[]).filter((r) => r.content?.content?.length)));
  }, []);

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return (rows ?? []).filter((r) => words.every((w) => `${r.title} ${r.slug}`.toLowerCase().includes(w)));
  }, [rows, q]);

  const insert = async (row: PatternRow) => {
    const stamp = `p${Date.now().toString(36)}`;
    const linked = isLinkedPattern(row.content);
    // Patterns can place other patterns; those become blocks too.
    const copy = reId(row.content!.content!, stamp);
    const blocks = linked
      ? [expandLinked({ type: 'pattern', props: { id: `lp${Date.now().toString(36)}`, attrs: { slug: row.slug, linked: true } } }, row.content!.content!)]
      : env
        ? await inlinePatterns(copy, env.ctx.loader)
        : copy;
    const { appState, dispatch, selectedItem } = getPuck();
    const content = appState.data.content as PuckItem[];
    const selectedId = (selectedItem?.props as any)?.id as string | undefined;
    const top = selectedId ? findBlock(content, selectedId)?.top : undefined;
    const next = top ? replaceBlock(content, top.props.id, [top, ...blocks]) : [...content, ...blocks];
    dispatch({ type: 'setData', data: { ...appState.data, content: next as Data['content'] }, recordHistory: true });
    const index = next.findIndex((i) => i.props.id === blocks[0]?.props.id);
    if (index >= 0) dispatch({ type: 'setUi', ui: { itemSelector: { index, zone: 'root:default-zone' } } });
    setNote(`Inserted "${row.title}" ${top ? 'after the selected section' : 'at the end of the page'}.`);
  };

  if (!rows) return <p className="p-4 text-sm text-admin-muted">Loading…</p>;
  return (
    <div className="text-sm">
      <div className="border-b border-admin-ink/10 p-3">
        <input
          type="search"
          className="w-full rounded border border-admin-ink/15 bg-white px-2 py-1.5 text-sm outline-none focus:border-admin-accent"
          placeholder="Search patterns"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <p className="mt-2 text-xs text-admin-muted">Inserts the pattern after the selected section, or at the end of the page. A copy is yours to change; a Linked pattern keeps its layout and style (change its content here, the rest in the pattern). Save any block as a pattern from its settings.</p>
        {note && (
          <p className="mt-2 text-xs text-[#3f7a3f]" role="status">
            {note}
          </p>
        )}
      </div>
      {!shown.length && <p className="p-4 text-admin-muted">{rows.length ? 'No patterns match.' : 'No patterns yet. Create them from Templates.'}</p>}
      <ul className="m-0 list-none divide-y divide-admin-ink/10 p-0">
        {shown.map((r) => (
          <li key={r.slug} className="px-3 py-3">
            <Thumbnail slug={r.slug} title={r.title || r.slug} />
            <div className="mt-2 flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {r.title || r.slug}
                  {isLinkedPattern(r.content) && <span className="ml-1.5 rounded bg-admin-accent/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-admin-accent-dark uppercase">Linked</span>}
                </span>
                <a href={`/admin/templates/pattern/${r.slug}/`} target="_blank" rel="noopener" className="block truncate text-[11px] text-admin-muted hover:text-admin-accent" title="Edit the pattern (opens in a new tab)">
                  {r.slug}
                </a>
              </span>
              <button type="button" className="shrink-0 rounded border border-admin-ink/15 bg-white px-2.5 py-1 text-xs hover:border-admin-accent hover:text-admin-accent" onClick={() => insert(r)}>
                Insert
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
