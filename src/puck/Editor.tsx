// The visual editor. Content mode edits an entry's blocks inside its template; layout mode edits the
// template document itself (pages like the homepage keep their content in the template).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Puck, blocksPlugin, createUsePuck, outlinePlugin, useGetPuck, type Data } from '@puckeditor/core';
import Composer, { type LivePage, type Selection } from '../admin/Composer';
import { isComposed } from '../lib/compose/outline';
import { locateInDoc, replaceInDoc } from '../lib/puck/tree';
import '@puckeditor/core/no-external.css'; // without its Inter webfont: the admin uses the system font
import { SITE_TZ, taxonomiesOf } from '../lib/site';
import { browserClient } from '../lib/db/browser';
import { Loader } from '../lib/data';
import { permalink } from '../lib/permalink';
import { mediaUrl } from '../lib/media/image';
import { prepare } from '../render/prepare';
import { register, renderItems } from '../render/engine';
import { templateCandidates, VENDOR_CSS } from '../render/page';
import { hasContentBlock, type TemplateInfo } from '../lib/templates';
import { MAIN_AREA, areaItems, areaProp, templateAreas, uniqueAreas } from '../lib/content/areas';
import { collapseAll } from '../lib/content/linked-patterns';
import { versionDoc } from '../lib/admin/revisions';
import { bodyClasses } from '../render/body-classes';
import { esc } from '../render/html';
import '../render/blocks';
import type { Env, RenderCtx } from '../render/env';
import type { PuckItem } from '../lib/puck/types';
import type { Entry } from '../lib/types';
import { buildConfig, EDITABLE_TYPES } from './config';
import { useEventsOn, useMailingOn, useMemberSettings } from './member-settings';
import { EnvContext, StaticHtml } from './BlockView';
import { EntryForm, type EntryState } from './entry-fields';
import { inlinePatterns } from './patterns';
import { PatternsPanel } from './PatternsPanel';
import { A11yMarksContext, A11yPanel } from './A11yPanel';
import parse, { Element, type DOMNode } from 'html-react-parser';
// The public site stylesheet, so the canvas matches the site.
import siteCss from '../styles/site.css?url';

export interface EditorProps {
  entryId?: number;
  template?: { kind: 'template' | 'part' | 'pattern'; slug: string };
  /** Admins get links from the template's blocks around the page's content to edit them (SourceLinks). */
  admin?: boolean;
}

const CONTENT_MARKER = '<cms-content></cms-content>';
/** Autosave: this long after the last edit, and at most this long after the first one not yet saved. */
const AUTOSAVE_DELAY = 3000;
const AUTOSAVE_MAX_WAIT = 30000;
/** What saving compares: the page's blocks and its root props (the template's other content areas). */
const docJson = (d: Data) => {
  // Accessibility marks save on their own as they are made (A11yPanel), so they aren't unsaved edits.
  const { a11y: _marks, ...props } = (d.root?.props ?? {}) as Record<string, unknown>;
  return JSON.stringify([d.content, props]);
};

function emptyCtx(loader: Loader, queried: RenderCtx['queried'], settings: Record<string, any>): RenderCtx {
  return { loader, queried, settings, queries: new Map(), docs: new Map(), css: [], assets: new Set(), data: new Map(), scripts: [], rendered: [], editor: true };
}

export default function Editor({ entryId, template, admin = false }: EditorProps) {
  const db = browserClient();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [state, setState] = useState<EntryState | null>(null);
  const [initial, setInitial] = useState<Data | null>(null);
  const [chrome, setChrome] = useState<PuckItem[]>([]);
  const [mode, setMode] = useState<'content' | 'layout'>('content');
  // The template's content areas besides main (slots on the page's root).
  const [areaList, setAreas] = useState<string[]>([]);
  const [templateSlug, setTemplateSlug] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [ctx, setCtx] = useState<RenderCtx | null>(null);
  const [status, setStatus] = useState<string>('');
  // Publishing state: live status, changes kept aside on a published page, edits not saved yet.
  const [liveStatus, setLiveStatus] = useState<string>('draft');
  const [pending, setPending] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revisionsVersion, setRevisionsVersion] = useState(0);
  const [autosaving, setAutosaving] = useState(false);
  const savedJson = useRef('');
  // The page settings as last saved (with savedJson: whether an autosave has anything left to save).
  const savedEntry = useRef('');
  // Autosave (a page's content, not templates: those apply to every page at once). It saves as Save
  // draft does, so a published page's changes are kept aside and the live page stays as it is.
  const canAutosave = useRef(false);
  const autosaveTimer = useRef<number | undefined>(undefined);
  const unsavedSince = useRef<number | null>(null);
  // Set when someone else saved meanwhile: autosave stops, and a manual save asks before replacing theirs.
  const autosaveBlocked = useRef(false);
  // The save under way, so saves go one at a time (each sends the version the last one stored).
  const inflight = useRef<Promise<unknown> | null>(null);
  const saveRef = useRef<(action: 'draft', auto: boolean) => Promise<unknown>>(async () => {});
  const scheduleAutosave = () => {
    if (!canAutosave.current || autosaveBlocked.current) return;
    const now = Date.now();
    unsavedSince.current ??= now;
    window.clearTimeout(autosaveTimer.current);
    const wait = Math.max(0, Math.min(AUTOSAVE_DELAY, unsavedSince.current + AUTOSAVE_MAX_WAIT - now));
    autosaveTimer.current = window.setTimeout(() => saveRef.current('draft', true), wait);
  };
  /** An edit to the page: unsaved until the next save, which autosave makes soon. */
  const edited = () => {
    setDirty(true);
    scheduleAutosave();
  };
  const [error, setError] = useState<string>('');
  const dataRef = useRef<Data | null>(null);
  const settingsRef = useRef<Record<string, any>>({});

  // Load entry + template, decide the editing mode.
  useEffect(() => {
    (async () => {
      const loader = new Loader(db);
      const settings = await loader.settings();
      settingsRef.current = settings;
      const { data: tpls } = await db.from('templates').select('slug, title, content').eq('kind', 'template').order('slug');
      setTemplates((tpls ?? []).map((t) => ({ slug: t.slug, title: t.title, content: hasContentBlock((t.content as any)?.content) })));

      if (template) {
        const doc = await loader.template(template.kind, template.slug);
        baseRef.current = (await db.from('templates').select('updated_at').eq('kind', template.kind).eq('slug', template.slug).maybeSingle()).data?.updated_at;
        const raw = (doc as Data) ?? { root: { props: {} }, content: [] };
        const data = { ...raw, content: (await inlinePatterns(raw.content as PuckItem[], loader)) as Data['content'] };
        setMode('layout');
        setTemplateSlug(template.slug);
        setChrome([]);
        setInitial(data);
        dataRef.current = data;
        savedJson.current = docJson(data);
        return;
      }

      const e = await loader.entryById(entryId!, true);
      if (!e) throw new Error('Entry not found');
      baseRef.current = e.updated_at;
      await loader.loadMedia(e.featured_media_id ? [e.featured_media_id] : []);
      await loader.allTerms();
      const queried = { kind: 'singular' as const, entry: e, page: 1, url: new URL(settings.site?.front_page_id === e.id ? '/' : permalink(e), location.origin), isFront: settings.site?.front_page_id === e.id };
      let tplItems: PuckItem[] = [];
      let slug: string | null = null;
      for (const s of templateCandidates(queried, settings.site?.templates)) {
        const doc = await loader.template('template', s);
        if (doc) {
          tplItems = doc.content as PuckItem[];
          slug = s;
          break;
        }
      }
      const media = e.featured_media_id ? loader.media.get(e.featured_media_id) : undefined;
      // Unpublished changes to a live page open instead of the live version.
      const [{ data: d }, { data: saved }] = await Promise.all([
        db.from('entry_drafts').select('draft').eq('entry_id', e.id).maybeSingle(),
        db.from('entries').select('draft_saved_at').eq('id', e.id).single(),
      ]);
      const draft = d?.draft as { content?: Data; entry?: EntryState } | null;
      setLiveStatus(e.status);
      setPending(draft ? saved?.draft_saved_at ?? null : null);
      if (draft?.content) e.content = draft.content;
      setEntry(e);
      if (draft?.entry) setState(draft.entry);
      else setState({
        title: e.title,
        slug: e.slug,
        status: e.status === 'trash' ? 'draft' : e.status,
        excerpt: e.excerpt,
        template: e.template,
        featured_image: media ? mediaUrl(media.path) : null,
        featured_media_id: media?.id ?? null,
        fields: e.fields ?? {},
        event_start: e.event_start,
        event_end: e.event_end,
        event_all_day: e.event_all_day || e.fields?.all_day === true,
        tags: (e.term_ids ?? []).map((id) => loader.terms.get(id)).filter((t) => t?.taxonomy === 'tag').map((t) => t!.name),
        terms: Object.fromEntries(taxonomiesOf(e.type).map((tax) => [tax, (e.term_ids ?? []).filter((id) => loader.terms.get(id)?.taxonomy === tax)])),
      });
      setTemplateSlug(slug);
      if (hasContentBlock(tplItems)) {
        setMode('content');
        setChrome(tplItems);
        const raw = (e.content as Data) ?? { root: { props: {} }, content: [] };
        // The template's other content areas are slots on the content's root (empty until filled).
        const others = templateAreas(tplItems).filter((a) => a !== MAIN_AREA);
        const rootProps: Record<string, unknown> = { ...(raw.root?.props ?? {}) };
        for (const area of others) rootProps[areaProp(area)] = await inlinePatterns(areaItems(raw, area) as PuckItem[], loader);
        setAreas(others);
        const data = { ...raw, root: { ...raw.root, props: rootProps }, content: (await inlinePatterns(raw.content as PuckItem[], loader)) as Data['content'] } as Data;
        setInitial(data);
        dataRef.current = data;
        savedJson.current = docJson(data);
        canAutosave.current = true;
      } else {
        setMode('layout');
        setChrome([]);
        if (slug) tplBaseRef.current = (await db.from('templates').select('updated_at').eq('kind', 'template').eq('slug', slug).maybeSingle()).data?.updated_at;
        const data = { root: { props: {} }, content: await inlinePatterns(tplItems, loader) } as Data;
        setInitial(data);
        dataRef.current = data;
        savedJson.current = docJson(data);
      }
    })().catch((err) => setError(String(err?.message ?? err)));
  }, []);

  // Build render context (queries, media, CSS) for the current document. Re-run on edits.
  const rebuild = useCallback(async () => {
    const loader = new Loader(db);
    const settings = settingsRef.current;
    // The page as edited so far: its settings and fields show in the canvas before saving.
    const e = entry
      ? {
          ...entry,
          fields: state?.fields ?? entry.fields,
          title: state?.title ?? entry.title,
          title_rendered: state && state.title !== entry.title ? null : entry.title_rendered,
          excerpt: state?.excerpt ?? entry.excerpt,
          featured_media_id: state ? (state.featured_media_id ?? null) : entry.featured_media_id,
        }
      : undefined;
    const queried = e
      ? { kind: 'singular' as const, entry: e, page: 1, url: new URL(settings.site?.front_page_id === e.id ? '/' : permalink(e), location.origin), isFront: settings.site?.front_page_id === e.id }
      : { kind: '404' as const, page: 1, url: new URL('/', location.origin) };
    const next = emptyCtx(loader, queried, settings);
    if (e) {
      loader.entries.set(e.id, e);
      if (e.featured_media_id) await loader.loadMedia([e.featured_media_id]);
    }
    const content = (dataRef.current?.content ?? []) as PuckItem[];
    const areas: PuckItem[] = [];
    if (e && mode === 'content') {
      next.docs.set(`content:${e.id}`, content);
      for (const area of areaList) {
        const items = areaItems(dataRef.current, area) as PuckItem[];
        next.docs.set(`content:${e.id}:${area}`, items);
        areas.push(...items);
      }
    }
    await prepare([...chrome, ...content, ...areas], next);
    setCtx(next);
  }, [entry, state, chrome, mode, areaList]);

  useEffect(() => {
    if (initial) rebuild().catch((err) => setError(String(err?.message ?? err)));
  }, [initial, chrome]);

  const timer = useRef<number | undefined>(undefined);
  const lastJson = useRef('');
  const onChange = (data: Data) => {
    dataRef.current = data;
    // A change of accessibility marks only (saved on their own): not an unsaved edit.
    if (marksOnly.current) {
      marksOnly.current = false;
      return;
    }
    const json = docJson(data);
    if (savedJson.current && json !== savedJson.current) setDirty(true);
    if (json === lastJson.current) return;
    lastJson.current = json;
    if (savedJson.current && json !== savedJson.current) scheduleAutosave();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => rebuild().catch((err) => setError(String(err?.message ?? err))), 500);
  };

  // Page settings and fields (a guide's itinerary, an event's dates...) update the canvas as they are edited.
  const stateTimer = useRef<number | undefined>(undefined);
  const firstState = useRef(true);
  useEffect(() => {
    if (!state) return;
    if (firstState.current) {
      firstState.current = false;
      return;
    }
    window.clearTimeout(stateTimer.current);
    stateTimer.current = window.setTimeout(() => rebuild().catch((err) => setError(String(err?.message ?? err))), 400);
    return () => window.clearTimeout(stateTimer.current);
  }, [state]);

  const env: Env | null = ctx ? { ctx, post: ctx.queried.entry ?? null, query: null, parentLayout: null } : null;

  // Stable across context rebuilds: a new config makes Puck re-resolve every block and fire onChange.
  // Editing an entry, the block list offers only blocks that apply to its type; templates get them all.
  const entryType = entry?.type;
  const members = useMemberSettings();
  const eventsAreOn = useEventsOn();
  const mailingIsOn = useMailingOn();
  const config = useMemo(() => {
    const c = buildConfig(EDITABLE_TYPES, entryType, { members: !!members?.enabled, events: eventsAreOn === true, mailing: mailingIsOn === true });
    c.root = {
      fields: state
        ? {
            entry: {
              type: 'custom',
              label: 'Page settings',
              render: () => <EntryFormBridge />,
            },
            ...Object.fromEntries(areaList.map((a) => [areaProp(a), { type: 'slot' }])),
          }
        : {},
      render: ({ children, ...props }: { children: ReactNode } & Record<string, any>) => <ChromeFromContext content={children} slots={props} />,
    } as any;
    return c;
  }, [state === null, entryType, areaList.join(), !!members?.enabled, eventsAreOn === true, mailingIsOn === true]);

  // Compose panel: docked beside the editor; pinned keeps it open (per browser).
  const puckRef = useRef<ReturnType<typeof useGetPuck> | null>(null);
  const [pinned, setPinned] = useState(readPinned);
  const [selection, setSelectionState] = useState<Selection | null>(null);
  // Only when the selected block or its data changed (a new object each time would re-render Puck in a loop).
  const setSelection = useCallback((next: Selection | null) => setSelectionState((prev) => (prev?.item === next?.item && prev?.top === next?.top ? prev : next)), []);
  const [composeOpen, setComposeOpen] = useState(() => readPinned() || new URLSearchParams(location.search).has('compose'));
  const pin = (on: boolean) => {
    setPinned(on);
    try {
      localStorage.setItem(PIN_KEY, on ? '1' : '0');
    } catch {}
  };
  const stateRef = useRef<EntryState | null>(null);
  stateRef.current = state;
  const live: LivePage = useMemo(
    () => ({
      fields: () => {
        const s = stateRef.current;
        return s ? { fields: s.fields, event_start: s.event_start, event_end: s.event_end, event_all_day: s.event_all_day } : null;
      },
      setFields: ({ fields, ...dates }) => {
        const s = stateRef.current;
        if (!s) return;
        const next = { ...s.fields };
        for (const [k, v] of Object.entries(fields)) {
          if (v === null) delete next[k];
          else next[k] = v;
        }
        const updated = { ...s, ...dates, fields: next } as EntryState;
        stateRef.current = updated;
        setState(updated);
        edited();
      },
      content: () => (puckRef.current?.().appState.data.content ?? []) as PuckItem[],
      apply: (items, prefix, replaceAll) => {
        const get = puckRef.current;
        if (!get) return;
        const { appState, dispatch } = get();
        const current = appState.data.content as PuckItem[];
        let next: PuckItem[];
        if (replaceAll) next = items;
        else {
          // In place of the blocks this conversation built before (or at the end).
          const at = current.findIndex((i) => isComposed(i, prefix));
          const rest = current.filter((i) => !isComposed(i, prefix));
          const pos = at >= 0 ? current.slice(0, at).filter((i) => !isComposed(i, prefix)).length : rest.length;
          next = [...rest.slice(0, pos), ...items, ...rest.slice(pos)];
        }
        dispatch({ type: 'setData', data: { ...appState.data, content: next as Data['content'] }, recordHistory: true });
      },
      replaceBlock: (id, items) => {
        const get = puckRef.current;
        if (!get) return;
        const { appState, dispatch } = get();
        // Anywhere on the page: its content or one of the template's other content areas.
        dispatch({ type: 'setData', data: replaceInDoc(appState.data as Data & { content: unknown }, id, items) as Data, recordHistory: true });
      },
    }),
    [],
  );


  // Leaving with unsaved changes: the browser asks on reload, close and back (it allows no dialog of
  // our own there); a link on the page opens the save dialog instead (LeaveDialog).
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const allowLeave = useRef(false);
  const [leaving, setLeaving] = useState<string | null>(null);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (!allowLeave.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download')) return;
      const to = new URL(link.href, location.href);
      // Opening in another tab, or a jump within this page, leaves nothing behind.
      if (to.origin === location.origin && to.pathname === location.pathname && to.search === location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setLeaving(to.href);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
  /** Whether anything in the editor isn't saved: the document, or the page's settings. */
  const unsavedNow = () => {
    const data = (puckRef.current?.().appState.data as Data | undefined) ?? dataRef.current;
    return !!data && (docJson(data) !== savedJson.current || (!!stateRef.current && JSON.stringify(stateRef.current) !== savedEntry.current));
  };
  const leaveTo = (href: string) => {
    allowLeave.current = true;
    location.href = href;
  };
  /** The dialog's Save: as Save draft does (content mode) or Save & apply (layouts), then leave if it all saved. */
  const saveAndLeave = async () => {
    const href = leaving;
    if (!href) return;
    await save(mode === 'content' && entry && !template ? 'draft' : 'save');
    if (unsavedNow()) return setLeaving(null);
    leaveTo(href);
  };

  /** The version last restored: its id, and the page as saving would store it then and before restoring (to tell if it was edited or undone). */
  const restoredRef = useRef<{ id: number; json: string; before: string } | null>(null);

  /**
   * Whether a version can be loaded into the editor: in content mode one with content; in layout mode
   * one saved with the page's current template (a version saved in layout mode keeps the template's content).
   */
  const canRestore = (r: RevisionRow) => (mode === 'content' ? !!r.content : r.template?.kind === 'template' && !!templateSlug && r.template.slug === templateSlug && Array.isArray(r.template.content?.content));

  /** Load a saved version into the editor as unsaved changes (undoable). Content mode autosaves it as a draft; layout mode keeps it on Save & apply. */
  const restore = async (r: RevisionRow) => {
    const get = puckRef.current;
    if (!get || !canRestore(r)) return;
    const loader = new Loader(db);
    const inline = (items: PuckItem[]) => inlinePatterns(items, loader);
    const current = get().appState.data as Data;
    // Content mode: the page's content and the template's other content areas as the version had them.
    const next = (mode === 'content' ? await versionDoc(current, r.content!, areaList, inline) : { ...current, content: await inline((r.template!.content.content ?? []) as PuckItem[]) }) as Data;
    const [before, after] = await Promise.all([collapseLinkedPatterns(current), collapseLinkedPatterns(next)]);
    restoredRef.current = { id: r.id, json: docJson(after.data), before: docJson(before.data) };
    get().dispatch({ type: 'setData', data: next, recordHistory: true });
    const base = stateRef.current;
    if (base) {
      const settings = r.entry ? { ...base, ...r.entry, status: base.status } : { ...base, title: r.title || base.title, fields: r.fields ?? base.fields };
      stateRef.current = settings;
      setState(settings);
    }
    edited();
    const when = new Date(r.saved_at ?? r.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    setStatus(mode === 'content' ? `Restored the version from ${when}` : `Restored the layout from ${when}: Save & apply keeps it, on every page using this template`);
  };

  /** Open the page as it will look, with the editor's current (unsaved) state, in a new tab. */
  const preview = () => {
    const data = (puckRef.current?.().appState.data as Data | undefined) ?? dataRef.current!;
    const payload = mode === 'content' ? { content: data, entry: stateRef.current } : { entry: stateRef.current, template: data.content };
    const form = document.createElement('form');
    form.method = 'post';
    form.action = `/admin/preview/${entryId}/`;
    form.target = '_blank';
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'payload';
    input.value = JSON.stringify(payload);
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
    form.remove();
  };

  /** Whether this save keeps a restored version (and whether it was edited since); nothing if the restore was undone. */
  const restoredNote = (stored: Data) => {
    const r = restoredRef.current;
    if (!r) return {};
    const now = docJson(stored);
    if (now === r.before) return {};
    return { restoredFrom: r.id, restoredEdited: now !== r.json };
  };

  /** Accessibility marks, saved as they are made: on the template being edited, else on the entry. */
  const marksOnly = useRef(false);
  // The stored version this editor is working from (updated_at): the entry's, or the template's when
  // editing one; and in layout mode the template's as well. Sent with a save, which is refused if
  // someone else saved in between.
  const baseRef = useRef<string | undefined>(undefined);
  const tplBaseRef = useRef<string | undefined>(undefined);
  const saveA11yMarks = async (marks: Record<string, unknown>): Promise<string | null> => {
    const target = template ? { kind: template.kind, slug: template.slug } : mode === 'layout' ? { kind: 'template', slug: templateSlug } : { entryId };
    const res = await fetch('/api/admin/a11y', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...target, marks }) }).catch(() => null);
    if (!res?.ok) return res ? await res.text() : 'no connection';
    const { updated_at } = await res.json().catch(() => ({}));
    if (updated_at) (!template && mode === 'layout' ? tplBaseRef : baseRef).current = updated_at;
    return null;
  };

  /**
   * save: templates and layout mode (apply at once); draft / publish / unpublish / discard: pages.
   * auto: an autosave (a draft), recorded in the history as part of the current stretch of edits rather
   * than as a checkpoint; it never asks anything, and stops if someone else saved meanwhile.
   */
  const save = async (action: 'save' | 'draft' | 'publish' | 'unpublish' | 'discard', auto = false) => {
    window.clearTimeout(autosaveTimer.current);
    if (auto && autosaveBlocked.current) return;
    const before = inflight.current;
    let done!: () => void;
    const mine = new Promise<void>((r) => (done = r));
    inflight.current = mine;
    await before?.catch(() => {});
    try {
      await saveNow(action, auto);
    } finally {
      done();
      if (inflight.current === mine) inflight.current = null;
    }
  };
  const saveNow = async (action: 'save' | 'draft' | 'publish' | 'unpublish' | 'discard', auto: boolean) => {
    // Nothing left to autosave (a save that ran meanwhile took it).
    if (auto && savedJson.current === docJson((puckRef.current?.().appState.data as Data | undefined) ?? dataRef.current!) && savedEntry.current === JSON.stringify(stateRef.current)) return;
    unsavedSince.current = null;
    let data = (puckRef.current?.().appState.data as Data | undefined) ?? dataRef.current!;
    // A template's Page content blocks each show their own area: a repeat gets the next free name.
    if (template || mode === 'layout') {
      const named = uniqueAreas(data.content as PuckItem[]);
      if (named !== data.content) {
        data = { ...data, content: named as Data['content'] };
        puckRef.current?.().dispatch({ type: 'setData', data });
      }
    }
    // What this save sends, to tell afterwards whether anything changed while it ran.
    const sentContent = docJson(data);
    const sentEntry = JSON.stringify(stateRef.current);
    const dirtyBefore = dirty;
    if (auto) setAutosaving(true);
    else setSaving(true);
    setStatus(action === 'publish' ? 'Publishing…' : action === 'discard' ? 'Discarding…' : 'Saving…');
    // Linked patterns are stored as a reference plus this page's content changes.
    const { data: stored, detached } = await collapseLinkedPatterns(data);
    const body = template
      ? { kind: template.kind, slug: template.slug, content: stored }
      : mode === 'content'
        ? action === 'discard' || action === 'unpublish' ? { action } : { action, content: stored, entry: stateRef.current, ...restoredNote(stored), ...(auto ? { autosave: true } : {}) }
        : { action: 'save', entry: stateRef.current, template: { kind: 'template', slug: templateSlug, content: stored }, ...restoredNote(stored) };
    const url = template ? '/api/admin/templates' : `/api/admin/entries/${entryId}`;
    const put = (bases: object) => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, ...bases }) });
    let res = await put({ base: baseRef.current, templateBase: tplBaseRef.current }).catch(() => null);
    if (auto) setAutosaving(false);
    if (!res) {
      setSaving(false);
      return setStatus(auto ? 'Not autosaved: no connection. It will try again after your next edit.' : 'Not saved: no connection.');
    }
    // Someone else saved it meanwhile. An autosave stops there; a save says so, and overwrites only if asked.
    if (res.status === 409 && auto) {
      autosaveBlocked.current = true;
      return setStatus('Not autosaved: someone else saved this since you opened it. Save to choose whose version to keep.');
    }
    if (res.status === 409 && window.confirm(`${await res.text()}\n\nSaving now replaces their version with yours. To see theirs first, cancel and reload the page (your unsaved changes here will be lost).\n\nSave anyway?`)) res = await put({});
    setSaving(false);
    if (res.status === 409) return setStatus('Not saved: someone else saved this since you opened it.');
    if (!res.ok) {
      return setStatus(`${auto ? 'Not autosaved' : 'Not saved'}: ${await res.text()}`);
    }
    autosaveBlocked.current = false;
    if (action === 'discard') return location.reload();
    const r = await res.json().catch(() => ({}));
    const nowData = (puckRef.current?.().appState.data as Data | undefined) ?? dataRef.current!;
    const changedSince = docJson(nowData) !== sentContent || JSON.stringify(stateRef.current) !== sentEntry;
    if (r.status) setLiveStatus(r.status);
    if (r.updated_at) baseRef.current = r.updated_at;
    if (r.templateUpdatedAt) tplBaseRef.current = r.templateUpdatedAt;
    // The address the server stored (a placeholder or empty one becomes one from the title).
    if (r.slug && stateRef.current && r.slug !== stateRef.current.slug) {
      const next = { ...stateRef.current, slug: r.slug };
      stateRef.current = next;
      setState(next);
    }
    if (mode === 'content' && !template) setPending(r.pending ? new Date().toISOString() : null);
    // Unpublish sends no content: edits not saved before stay unsaved. Otherwise what was sent is saved,
    // and anything changed while the save ran is not.
    if (action === 'unpublish') {
      setDirty(dirtyBefore);
      if (dirtyBefore) scheduleAutosave();
    }
    else {
      savedJson.current = sentContent;
      savedEntry.current = sentEntry;
      setDirty(changedSince);
      if (changedSince) scheduleAutosave();
    }
    // A restored version is noted on each autosave and on the checkpoint that keeps it.
    if (!auto) restoredRef.current = null;
    setRevisionsVersion((v) => v + 1);
    const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const warned = r.warning ? ` ${r.warning}` : '';
    const note = warned + (detached ? ` ${detached === 1 ? 'A linked pattern whose blocks were changed was' : `${detached} linked patterns whose blocks were changed were`} saved as an ordinary copy.` : '');
    setStatus((auto ? `Autosaved ${time}` : action === 'publish' ? `Published ${time}` : action === 'unpublish' ? `Unpublished ${time}` : action === 'draft' ? `Draft saved ${time}` : `Saved ${time}`) + note);
  };
  saveRef.current = save;

  if (error) return <p className="p-8 text-[#c4592a]">{error}</p>;
  if (!initial || !env) return <p className="p-8 text-admin-muted">Loading editor…</p>;

  const viewUrl = entry && settingsRef.current.site?.front_page_id !== entry.id ? permalink(entry) : '/';
  const titleText = entry ? state?.title || '(untitled)' : `${template?.kind === 'part' ? 'Template part' : template?.kind === 'pattern' ? 'Pattern' : 'Template'}: ${template?.slug}`;
  return (
    <div className="flex h-screen">
    <div className="flex min-w-0 flex-1 flex-col">
    {/* Page title and address, above Puck (outside its header, so its toolbar keeps its own layout). */}
    <div className="flex shrink-0 items-baseline gap-3 border-b border-admin-ink/10 bg-white px-4 py-2">
      <a href={entry ? `/admin/?type=${entry.type}` : '/admin/templates/'} className="text-xs text-admin-muted hover:text-admin-accent" title="Back to the list">
        ←
      </a>
      <h1 className="truncate text-lg">{titleText}</h1>
      {entry && <span className="truncate font-mono text-xs text-admin-muted">{viewUrl}</span>}
    </div>
    <div className="cms-editor-frame relative min-h-0 flex-1">
    <EnvContext.Provider value={env}>
      <RevisionsContext.Provider value={{ entryId: entry?.id ?? null, version: revisionsVersion, layout: mode === 'layout' ? templateSlug : null, canRestore: (r) => !!entry && canRestore(r), restore }}>
      <A11yMarksContext.Provider value={{ save: saveA11yMarks, quiet: () => (marksOnly.current = true) }}>
      <ViewContext.Provider value={{ env, chrome, sources: admin ? templateSlug : null, form: { type: entry?.type ?? '', state, setState: (v) => { stateRef.current = v; setState(v); edited(); }, templates } }}>
      <Puck
        config={config}
        data={initial}
        onChange={onChange}
        onPublish={() => save(entry && mode === 'content' ? 'publish' : 'save')}
        plugins={PLUGINS}
        iframe={IFRAME}
        // The title and address are on the bar above the editor; Puck falls back to the page title when
        // this is empty, so it gets an invisible one.
        headerTitle={'\u200b'}
        overrides={{
          iframe: CanvasFrame,
          headerActions: ({ children }) => (
            <>
              {mode === 'layout' && entry && <span className="max-w-xs text-xs text-admin-muted">Editing this page's template ({templateSlug}); changes apply to every page using it.</span>}
              <PuckBridge into={puckRef} onSelect={setSelection} />
              {entry && mode === 'content' && (
                <span className="flex items-center gap-2 whitespace-nowrap text-xs text-admin-muted">
                  <span className={`rounded-full px-2 py-0.5 ${liveStatus === 'publish' ? 'bg-[#6db56d]/15 text-[#3f7a3f]' : 'bg-admin-muted/10'}`}>{liveStatus === 'publish' ? 'Published' : 'Draft'}</span>
                  {liveStatus === 'publish' && pending && !dirty && <span title={`Saved ${new Date(pending).toLocaleString()}`}>Unpublished changes</span>}
                  {dirty && <span className="text-admin-accent">{autosaving ? 'Saving…' : status.startsWith('Restored') || status.startsWith('Not ') ? status : 'Unsaved changes'}</span>}
                  {!dirty && status && <span>{status}</span>}
                  {liveStatus === 'publish' && pending && (
                    <button type="button" className="underline hover:text-[#c4592a]" onClick={() => confirm('Discard the unpublished changes and go back to the live page?') && save('discard')}>
                      Discard changes
                    </button>
                  )}
                  {liveStatus === 'publish' && (
                    <button type="button" className="underline hover:text-[#c4592a]" onClick={() => confirm('Take this page off the site? It stays here as a draft.') && save('unpublish')}>
                      Unpublish
                    </button>
                  )}
                </span>
              )}
              {!(entry && mode === 'content') && (dirty || status) && <span className={`text-xs ${dirty && !status.startsWith('Restored') ? 'text-admin-accent' : 'text-admin-muted'}`}>{dirty && !status.startsWith('Restored') && !status.startsWith('Not ') ? 'Unsaved changes' : status}</span>}
              {(entry || template) && (
                <button type="button" onClick={() => setComposeOpen((v) => !v)} aria-pressed={composeOpen} className={`whitespace-nowrap rounded border px-3 py-1.5 text-sm ${composeOpen ? 'border-admin-accent text-admin-accent' : 'border-admin-ink/15 hover:border-admin-accent hover:text-admin-accent'}`}>
                  Compose
                </button>
              )}
              {entry && (
                <button type="button" onClick={preview} className="whitespace-nowrap text-sm text-admin-muted hover:text-admin-accent" title="See the page as it will look, including unsaved changes">
                  Preview
                </button>
              )}
              {entry && liveStatus === 'publish' && <a href={viewUrl} target="_blank" className="whitespace-nowrap text-sm text-admin-muted hover:text-admin-accent">View live</a>}
              {entry && (
                <form method="post" action="/api/admin/entries" onSubmit={(e) => dirty && !window.confirm('The copy is made from the saved page; your unsaved changes won\'t be in it. Duplicate anyway?') && e.preventDefault()}>
                  <input type="hidden" name="duplicate" value={entry.id} />
                  <button className="whitespace-nowrap text-sm text-admin-muted hover:text-admin-accent" title="Make a draft copy of this page and open it">
                    Duplicate
                  </button>
                </form>
              )}
              {entry && mode === 'content' ? (
                <>
                  <button type="button" disabled={saving} onClick={() => save('draft')} className="whitespace-nowrap rounded border border-admin-ink/20 px-3 py-1.5 text-sm hover:border-admin-accent hover:text-admin-accent disabled:opacity-50" title={liveStatus === 'publish' ? 'Keep your changes without changing the live page' : 'Save without publishing'}>
                    Save draft
                  </button>
                  <button type="button" disabled={saving} onClick={() => save('publish')} className="whitespace-nowrap rounded bg-admin-ink px-4 py-1.5 text-sm font-medium text-white hover:bg-admin-accent disabled:opacity-50">
                    {liveStatus === 'publish' ? 'Publish changes' : 'Publish'}
                  </button>
                </>
              ) : (
                <button type="button" disabled={saving} onClick={() => save('save')} className="whitespace-nowrap rounded bg-admin-ink px-4 py-1.5 text-sm font-medium text-white hover:bg-admin-accent disabled:opacity-50" title="Templates have no drafts: changes apply to every page using them">
                  Save &amp; apply
                </button>
              )}
            </>
          ),
        }}
      />
      </ViewContext.Provider>
      </A11yMarksContext.Provider>
      </RevisionsContext.Provider>
    </EnvContext.Provider>
    </div>
    </div>
    {leaving && (
      <LeaveDialog
        saveLabel={mode === 'content' && entry && !template ? (liveStatus === 'publish' ? 'Save as unpublished changes' : 'Save draft') : 'Save & apply'}
        note={mode === 'content' && entry && !template ? (liveStatus === 'publish' ? 'The live page stays as it is until you publish.' : null) : 'Save & apply changes every page using this template.'}
        saving={saving}
        onSave={saveAndLeave}
        onDiscard={() => leaveTo(leaving)}
        onStay={() => setLeaving(null)}
      />
    )}
    {(entry || template) && composeOpen && (
      <aside className="h-screen w-[400px] shrink-0 border-l border-admin-ink/10" aria-label="Compose with Claude">
        <Composer
          entryId={entry?.id}
          templateKey={template ? `${template.kind}:${template.slug}` : undefined}
          layout={template ? { kind: template.kind, slug: template.slug, page: false } : mode === 'layout' && templateSlug ? { kind: 'template', slug: templateSlug, page: true } : undefined}
          live={live}
          selection={selection}
          pinned={pinned}
          onPin={pin}
          onClose={() => setComposeOpen(false)}
        />
      </aside>
    )}
    </div>
  );
}

const usePuckSelector = createUsePuck();

/** Asked when a link would leave the editor with unsaved changes: save first, leave without saving, or stay. */
function LeaveDialog({ saveLabel, note, saving, onSave, onDiscard, onStay }: { saveLabel: string; note: string | null; saving: boolean; onSave: () => void; onDiscard: () => void; onStay: () => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onStay();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-admin-ink/40 p-4" onClick={(e) => e.target === e.currentTarget && onStay()}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="leave-title" aria-describedby="leave-text" className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2 id="leave-title" className="text-lg">Save your changes?</h2>
        <p id="leave-text" className="mt-1 text-sm text-admin-muted">
          You have changes that aren't saved. {note}
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2 text-sm">
          <button type="button" onClick={onStay} className="rounded px-3 py-1.5 text-admin-muted hover:text-admin-ink">
            Stay
          </button>
          <button type="button" onClick={onDiscard} className="rounded border border-admin-ink/20 px-3 py-1.5 hover:border-[#c4592a] hover:text-[#c4592a]">
            Leave without saving
          </button>
          <button ref={first} type="button" disabled={saving} onClick={onSave} className="rounded bg-admin-ink px-4 py-1.5 font-medium text-white hover:bg-admin-accent disabled:opacity-50">
            {saving ? 'Saving…' : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The document as saved: each linked pattern collapsed to its reference and this page's content changes. */
async function collapseLinkedPatterns(data: Data): Promise<{ data: Data; detached: number }> {
  const cache = new Map<string, PuckItem[] | null>();
  const patternItems = async (slug: string) => {
    if (!cache.has(slug)) {
      const { data: row } = await browserClient().from('templates').select('content').eq('kind', 'pattern').eq('slug', slug).maybeSingle();
      cache.set(slug, ((row?.content as any)?.content as PuckItem[] | undefined) ?? null);
    }
    return cache.get(slug)!;
  };
  const main = await collapseAll(data.content as PuckItem[], patternItems);
  let detached = main.detached;
  const props = { ...((data.root?.props ?? {}) as Record<string, unknown>) };
  for (const [k, v] of Object.entries(props)) {
    if (!k.startsWith('area-') || !Array.isArray(v)) continue;
    const r = await collapseAll(v as PuckItem[], patternItems);
    props[k] = r.items;
    detached += r.detached;
  }
  return { data: { ...data, root: { ...data.root, props }, content: main.items as Data['content'] }, detached };
}

/** One of the template's other content areas on the page: its blocks, or while it is empty, a label in the spot to drop them. */
function AreaSlot({ area, Slot }: { area: string; Slot: unknown }) {
  const count = usePuckSelector((s) => ((s.appState.data.root?.props as Record<string, unknown> | undefined)?.[areaProp(area)] as unknown[] | undefined)?.length ?? 0);
  if (typeof Slot !== 'function') return null;
  const S = Slot as (props: Record<string, unknown>) => ReactNode;
  return (
    <div className="cms-area">
      {!count && <div className="cms-area__label">Content area: {area}. Drop blocks here.</div>}
      <S />
    </div>
  );
}

/** Gives the docked composer (outside Puck's tree) the editor's live data and the selected block. */
function PuckBridge({ into, onSelect }: { into: { current: ReturnType<typeof useGetPuck> | null }; onSelect: (s: Selection | null) => void }) {
  into.current = useGetPuck();
  const selectedId = usePuckSelector((s) => (s.selectedItem?.props as any)?.id as string | undefined);
  const data = usePuckSelector((s) => s.appState.data);
  useEffect(() => {
    const found = selectedId ? locateInDoc(data as Parameters<typeof locateInDoc>[0], selectedId) : null;
    onSelect(found ? { item: found.item, top: found.top } : null);
  }, [selectedId, data]);
  return null;
}

/**
 * Puck's canvas settings. A constant: Puck resets its first undo step to the current state whenever
 * this object changes, so a new object per render made the first edit impossible to undo.
 */
const IFRAME = { enabled: true, syncHostStyles: false, waitForStyles: true };

interface RevisionRow { id: number; created_at: string; saved_at: string | null; action: string | null; title: string; author_id: string | null; content: Data | null; entry: EntryState | null; fields: Record<string, any> | null; template: { kind: string; slug: string; content: Data } | null; restored_from: number | null; restored_edited: boolean | null }
interface RevisionsApi {
  entryId: number | null;
  version: number;
  /** Layout mode: the template the page is edited as. */
  layout: string | null;
  canRestore: (r: RevisionRow) => boolean;
  restore: (r: RevisionRow) => void;
}
const RevisionsContext = createContext<RevisionsApi | null>(null);
const ACTIONS: Record<string, string> = { draft: 'Draft saved', publish: 'Published', unpublish: 'Unpublished', save: 'Saved', autosave: 'Autosaved' };

/**
 * Left rail: saved versions of this page, newest first, to preview or restore. Manual saves (Save draft,
 * Publish...) are checkpoints; autosaves in between show as one version per stretch of editing.
 */
function RevisionsPanel() {
  const api = useContext(RevisionsContext);
  const [rows, setRows] = useState<RevisionRow[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [checkpointsOnly, setCheckpointsOnly] = useState(false);
  useEffect(() => {
    if (!api?.entryId) return;
    const db = browserClient();
    db.from('revisions').select('id, created_at, saved_at, action, title, author_id, content, entry, fields, template, restored_from, restored_edited').eq('entry_id', api.entryId).order('id', { ascending: false }).limit(50)
      .then(async ({ data }) => {
        setRows((data ?? []) as RevisionRow[]);
        const ids = [...new Set((data ?? []).map((r) => r.author_id).filter(Boolean))];
        if (ids.length) {
          const { data: people } = await db.from('profiles').select('id, display_name').in('id', ids);
          setNames(Object.fromEntries((people ?? []).map((p) => [p.id, p.display_name ?? ''])));
        }
      });
  }, [api?.entryId, api?.version]);
  if (!api?.entryId) return <p className="p-4 text-sm text-admin-muted">Templates have no revisions.</p>;
  if (!rows) return <p className="p-4 text-sm text-admin-muted">Loading…</p>;
  if (!rows.length) return <p className="p-4 text-sm text-admin-muted">No saved versions yet. Your edits save as you go; Save draft and Publish add checkpoints.</p>;
  const when = (s: string) => new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: SITE_TZ });
  const time = (s: string) => new Date(s).toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: SITE_TZ });
  const isAuto = (r: RevisionRow) => r.action === 'autosave';
  const shown = checkpointsOnly ? rows.filter((r) => !isAuto(r)) : rows;
  return (
    <div className="text-sm">
      <label className="flex items-center gap-2 border-b border-admin-ink/10 px-3 py-2 text-xs text-admin-muted">
        <input type="checkbox" checked={checkpointsOnly} onChange={(e) => setCheckpointsOnly(e.target.checked)} />
        Checkpoints only
      </label>
      {!shown.length && <p className="p-4 text-admin-muted">No checkpoints yet. Save draft or Publish adds one.</p>}
      <ol className="divide-y divide-admin-ink/10">
        {shown.map((r) => {
          const at = r.saved_at ?? r.created_at;
          // An autosave covering more than a minute of edits says when they began.
          const since = isAuto(r) && Date.parse(at) - Date.parse(r.created_at) > 60_000 ? ` (edits since ${time(r.created_at)})` : '';
          return (
            <li key={r.id} className={`px-3 py-2.5 ${isAuto(r) ? '' : 'border-l-2 border-admin-accent'}`}>
              <div className="flex items-baseline gap-2">
                <span className={isAuto(r) ? 'text-admin-muted' : 'font-medium'}>{when(at)}</span>
                {!isAuto(r) && <span className="rounded-full bg-admin-accent/10 px-1.5 text-[11px] text-admin-accent">Checkpoint</span>}
                {r.id === rows[0].id && <span className="text-[11px] text-admin-muted">latest</span>}
              </div>
              <div className="text-xs text-admin-muted">
                {ACTIONS[r.action ?? ''] ?? 'Saved'}
                {since}
                {r.author_id && names[r.author_id] ? ` by ${names[r.author_id]}` : ''}
                {r.title ? ` · ${r.title}` : ''}
              </div>
              {r.restored_from && (
                <div className="mt-0.5 text-xs text-[#8a5a1f]">
                  Restored from {(() => {
                    const from = rows.find((x) => x.id === r.restored_from);
                    return from ? when(from.saved_at ?? from.created_at) : 'an earlier version';
                  })()}
                  {r.restored_edited ? ', then edited' : ''}
                </div>
              )}
              <div className="mt-1 flex gap-3 text-xs">
                <a href={`/admin/preview/${api.entryId}/?revision=${r.id}`} target="_blank" rel="noopener" className="text-admin-muted underline hover:text-admin-accent">
                  Preview
                </a>
                {api.canRestore(r) && (
                  <button type="button" className="text-admin-muted underline hover:text-admin-accent" onClick={() => api.restore(r)}>
                    Restore
                  </button>
                )}
              </div>
              {api.layout && !api.canRestore(r) && (
                <div className="mt-0.5 text-xs text-admin-muted">{r.template ? `Saved with another template (${r.template.slug})` : 'No layout kept with this version'}: preview only.</div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const REVISIONS_ICON = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
    <path d="M3 4v4h4" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);
const PATTERNS_ICON = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="3.5" width="17" height="6" rx="1.5" />
    <rect x="3.5" y="12.5" width="7.5" height="8" rx="1.5" />
    <rect x="13" y="12.5" width="7.5" height="8" rx="1.5" />
  </svg>
);
const A11Y_ICON = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="4.5" r="1.8" />
    <path d="M4.5 8.5l7.5 1.5 7.5-1.5M12 10v4.5M12 14.5l-3.5 6M12 14.5l3.5 6" />
  </svg>
);
/**
 * The left rail, top to bottom. Puck lists its own Blocks and Outline first, but a plugin given again
 * moves to where it appears here.
 */
const PLUGINS = [
  blocksPlugin({ label: 'Blocks' }),
  { name: 'patterns', label: 'Patterns', icon: PATTERNS_ICON, render: () => <PatternsPanel /> },
  outlinePlugin({ label: 'Outline' }),
  { name: 'a11y', label: 'A11y', icon: A11Y_ICON, render: () => <A11yPanel /> },
  { name: 'revisions', label: 'Revisions', icon: REVISIONS_ICON, render: () => <RevisionsPanel /> },
];

const PIN_KEY = 'cms-compose-pinned';
const readPinned = () => {
  try {
    return localStorage.getItem(PIN_KEY) === '1';
  } catch {
    return false;
  }
};

interface ViewState {
  env: Env;
  chrome: PuckItem[];
  /** The template's slug when the canvas marks where its blocks come from (admins), else null. */
  sources: string | null;
  form: { type: string; state: EntryState | null; setState: (v: EntryState) => void; templates: TemplateInfo[] };
}
const ViewContext = createContext<ViewState | null>(null);

function ChromeFromContext({ content, slots }: { content: ReactNode; slots?: Record<string, any> }) {
  const view = useContext(ViewContext);
  return <Chrome env={view?.env ?? null} chrome={view?.chrome ?? []} sources={view?.sources ?? null} content={content} slots={slots} />;
}

function EntryFormBridge() {
  const getPuck = useGetPuck();
  const view = useContext(ViewContext);
  if (!view?.form.state) return null;
  const f = view.form;
  return <EntryForm type={f.type} value={f.state!} onChange={f.setState} templates={f.templates} pageItems={() => getPuck().appState.data.content as any[]} />;
}

/** Template around the editable content, rendered statically (header, footer, template sections). */
function Chrome({ env, chrome, sources, content, slots }: { env: Env | null; chrome: PuckItem[]; sources: string | null; content: ReactNode; slots?: Record<string, any> }) {
  const marked = useMemo(() => (sources !== null ? markSources(chrome, sources) : chrome), [chrome, sources]);
  if (!env) return null;
  if (!chrome.length) return <div className="c-page">{content}</div>;
  const html = renderItems(marked, { ...env, contentSlot: CONTENT_MARKER });
  const tree = parse(`<div class="c-page">${html}</div>`, {
    replace(node: DOMNode) {
      if (node instanceof Element && node.name === 'cms-content') {
        // The main area is the page's content; each other area is a slot of the page's root.
        const area = node.attribs['data-area'] || MAIN_AREA;
        if (area === MAIN_AREA) return <>{content}</>;
        const Slot = slots?.[areaProp(area)];
        return <AreaSlot area={area} Slot={Slot} />;
      }
      return undefined;
    },
  });
  return (
    <>
      {tree}
      {sources !== null && <SourceLinks />}
    </>
  );
}

type Source = { kind: 'template' | 'part' | 'pattern'; slug: string };
const SOURCE_BLOCK = 'cms-source';
const SOURCE_LABELS: Record<Source['kind'], string> = { template: 'template', part: 'template part', pattern: 'pattern' };

/** Where a block of the template comes from: a part, a pattern, else the template itself (globals: no link). */
function sourceOf(item: PuckItem, templateSlug: string): Source | null {
  const slug = item.props.attrs?.slug;
  if (item.type === 'part' && slug) return { kind: 'part', slug };
  if ((item.type === 'pattern' || item.type === 'core/pattern') && slug) return { kind: 'pattern', slug };
  if (item.type === 'global') return null;
  return templateSlug ? { kind: 'template', slug: templateSlug } : null;
}

/** The template's blocks around the page's content, each wrapped in a SOURCE_BLOCK naming where it comes from. */
function markSources(items: PuckItem[], templateSlug: string): PuckItem[] {
  return items.map((item) => {
    // A block holding the page's content isn't the template's alone: its other blocks are marked instead.
    if (hasContentBlock([item])) return item.props.children ? { ...item, props: { ...item.props, children: markSources(item.props.children, templateSlug) } } : item;
    const source = sourceOf(item, templateSlug);
    return source ? { type: SOURCE_BLOCK, props: { id: `${item.props.id}-source`, attrs: source, children: [item] } } : item;
  });
}

// Renders its block with the parent's env (so it renders as without the wrapper), its first element
// tagged with the source (data-cms-source="<kind>:<slug>"). Only markSources adds these, in the canvas.
register({
  [SOURCE_BLOCK]: (b, env) =>
    renderItems(b.children, env).replace(/<(?![/!?]|(?:script|style|link)\b)[a-zA-Z][\w-]*/, (tag) => `${tag} data-cms-source="${esc(`${b.attrs.kind}:${b.attrs.slug}`)}"`),
});

/** In the canvas, for admins: hovering a block from the template, a template part or a pattern outlines it, with a link to edit it there. */
function SourceLinks() {
  const ref = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState<(Source & { rect: DOMRect }) | null>(null);
  useEffect(() => {
    const doc = ref.current?.ownerDocument;
    const win = doc?.defaultView;
    if (!doc || !win) return;
    let el: HTMLElement | null = null;
    const place = () => {
      const [kind, ...slug] = (el?.dataset.cmsSource ?? '').split(':');
      setHover(el && el.isConnected ? { kind: kind as Source['kind'], slug: slug.join(':'), rect: el.getBoundingClientRect() } : null);
    };
    const over = (e: Event) => {
      const t = e.target as HTMLElement;
      if (t.closest?.('.cms-source-link')) return;
      const next = t.closest?.<HTMLElement>('[data-cms-source]') ?? null;
      if (next !== el) {
        el = next;
        place();
      }
    };
    const leave = () => {
      el = null;
      place();
    };
    doc.addEventListener('mouseover', over);
    doc.documentElement.addEventListener('mouseleave', leave);
    win.addEventListener('scroll', place, true);
    win.addEventListener('resize', place);
    return () => {
      doc.removeEventListener('mouseover', over);
      doc.documentElement.removeEventListener('mouseleave', leave);
      win.removeEventListener('scroll', place, true);
      win.removeEventListener('resize', place);
    };
  }, []);
  const r = hover?.rect;
  return (
    <>
      <span ref={ref} hidden />
      {hover && r && (
        <>
          <div className="cms-source-outline" style={{ top: r.top, left: r.left, width: r.width, height: r.height }} />
          <a
            className="cms-source-link"
            href={`/admin/templates/${hover.kind}/${hover.slug.split('/').map(encodeURIComponent).join('/')}/`}
            target="_blank"
            rel="noopener"
            style={{ top: Math.max(r.top, 0) + 6, left: Math.min(r.right, ref.current?.ownerDocument.documentElement.clientWidth ?? r.right) - 6, transform: 'translateX(-100%)' }}
          >
            Edit {SOURCE_LABELS[hover.kind] ?? hover.kind}: {hover.slug}
          </a>
        </>
      )}
    </>
  );
}

/** Load the public site's CSS into the canvas iframe (never into the admin UI). */
/** Puck's iframe override. A stable component: an inline function would remount the canvas styles on every render. */
function CanvasFrame({ children, document }: { children: ReactNode; document?: Document }) {
  const env = useContext(EnvContext);
  return (
    <CanvasStyles document={document} ctx={env?.ctx ?? null}>
      {children}
    </CanvasStyles>
  );
}

function CanvasStyles({ document: doc, ctx, children }: { document?: Document; ctx: RenderCtx | null; children: ReactNode }) {
  // The canvas context is rebuilt after every edit. Stylesheets are set up once per canvas document
  // (re-adding them on each edit unloaded the site CSS for a moment: the canvas flashed); only the
  // per-page rules and body classes follow the latest context.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const ready = !!ctx;
  useEffect(() => {
    const first = ctxRef.current;
    if (!doc || !first) return;
    doc.querySelectorAll('[data-cms]').forEach((n) => n.remove());
    const add = (el: HTMLElement) => {
      el.dataset.cms = '1';
      doc.head.appendChild(el);
    };
    // Set below: re-checks positions once a stylesheet has loaded (see `fix`).
    let restyled = () => {};
    const link = (href: string) => {
      const l = doc.createElement('link');
      l.rel = 'stylesheet';
      l.href = href;
      l.addEventListener('load', () => restyled());
      add(l);
    };
    // Third-party widget styles, then the site stylesheet (any block can be added, so load both).
    for (const href of Object.values(VENDOR_CSS)) link(href);
    const style = doc.createElement('style');
    // Puck's drop zones fill their parent's height; a media-text column must keep its own so its text
    // position (align-self) shows as on the site.
    style.textContent = '.cms-editor-note{padding:1rem;border:1px dashed #b87333;color:#64748b;font:13px system-ui}.c-media-text__content[data-puck-dropzone]{height:auto}.cms-area{position:relative}.cms-area__label{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;color:#64748b;font:13px system-ui;z-index:1}.cms-source-outline{position:fixed;z-index:9998;pointer-events:none;outline:2px dashed #b87333;outline-offset:-2px}.cms-source-link{position:fixed;z-index:9999;padding:4px 10px;border-radius:4px;background:#0f0f1c;color:#fff;font:500 12px/1.4 system-ui;text-decoration:none;white-space:nowrap}.cms-source-link:hover,.cms-source-link:focus-visible{background:#b87333}';
    add(style);
    link(siteCss);
    // Layout rules for sections added or changed while editing are created during rendering.
    const live = doc.createElement('style');
    add(live);
    let synced = '';
    const syncCss = () => {
      const c = ctxRef.current;
      if (!c) return;
      const rules = [...new Set(c.css)].join('');
      if (rules !== synced) {
        synced = rules;
        live.textContent = rules;
      }
      const cls = bodyClasses(c.queried);
      if (doc.body.className !== cls) doc.body.className = cls;
    };
    syncCss();
    const sync = setInterval(syncCss, 300);
    link('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,300;1,9..144,400&family=Work+Sans:wght@300;400;500;600;700&display=swap');
    // Links inside the canvas must not navigate the editor frame (the edit links open a new tab).
    const stop = (e: Event) => {
      if ((e.target as HTMLElement).closest?.('a:not(.cms-source-link)')) e.preventDefault();
    };
    doc.addEventListener('click', stop, true);

    // Puck sets inline position:relative on draggable elements; where the site's CSS positions an
    // element (e.g. absolute card images), let the stylesheet win so the canvas matches the site.
    const view = doc.defaultView!;
    // Elements that keep Puck's relative position; remembered so restoring it doesn't re-trigger the
    // observer below (clearing and restoring are both style mutations).
    // Decided again whenever a stylesheet loads: before the site's CSS arrives every element looks static.
    let keep = new WeakSet<HTMLElement>();
    const fix = (el: HTMLElement) => {
      if (el.style.position !== 'relative' || keep.has(el)) return;
      el.style.position = '';
      if (view.getComputedStyle(el).position === 'static') {
        keep.add(el);
        el.style.position = 'relative';
      }
    };
    const scan = () => doc.querySelectorAll<HTMLElement>('[data-puck-component]').forEach(fix);
    scan();
    restyled = () => {
      // Elements kept relative were judged without the site's CSS: let them be judged again.
      doc.querySelectorAll<HTMLElement>('[data-puck-component]').forEach((el) => keep.has(el) && el.style.position === 'relative' && (el.style.position = ''));
      keep = new WeakSet<HTMLElement>();
      doc.querySelectorAll<HTMLElement>('[data-puck-component]').forEach((el) => {
        if (el.style.position === '' && view.getComputedStyle(el).position === 'static') {
          keep.add(el);
          el.style.position = 'relative';
        }
      });
    };
    const observer = new view.MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes' && r.target instanceof view.HTMLElement && r.target.hasAttribute('data-puck-component')) fix(r.target);
        if (r.type === 'childList') r.addedNodes.forEach((n) => n instanceof view.HTMLElement && [n, ...n.querySelectorAll<HTMLElement>('[data-puck-component]')].forEach((e) => e.hasAttribute('data-puck-component') && fix(e)));
      }
    });
    observer.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
    return () => {
      observer.disconnect();
      clearInterval(sync);
      doc.removeEventListener('click', stop, true);
      doc.querySelectorAll('[data-cms]').forEach((n) => n.remove());
    };
  }, [doc, ready]);
  return <>{children}</>;
}

export { StaticHtml };
