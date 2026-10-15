// Compose with Claude, as a conversation that is saved per page: describe the page and add documents,
// images, videos, video links and links; Claude builds it, then revises it on request. Used on
// /admin/compose/ (the first message creates a draft) and docked beside the page editor, where builds
// replace the sections Claude made before and leave the rest of the page alone.
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { MediaModal } from '../puck/fields';
import type { PuckItem } from '../lib/puck/types';
import { COMPOSABLE_TYPES } from '../lib/site';
import { outline, isComposed } from '../lib/compose/outline';
import { inline } from '../lib/compose/build';

/** Claude's replies: paragraphs and "- " lists with inline Markdown (escaped first). */
function Reply({ text }: { text: string }) {
  const blocks = text.trim().split(/\n\s*\n/);
  return (
    <div className="space-y-2">
      {blocks.map((b, i) => {
        const lines = b.split('\n').filter((l) => l.trim());
        if (lines.length && lines.every((l) => /^\s*([-*]|\d+[.)]) /.test(l)))
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {lines.map((l, j) => (
                <li key={j} dangerouslySetInnerHTML={{ __html: inline(l.replace(/^\s*([-*]|\d+[.)]) /, '')) }} />
              ))}
            </ul>
          );
        return <p key={i} dangerouslySetInnerHTML={{ __html: lines.map(inline).join('<br>') }} />;
      })}
    </div>
  );
}

interface Attachment { ref?: string; kind: string; label: string; src?: string }
interface ChatTurn { role: 'user' | 'assistant'; text: string; attachments?: Attachment[]; target?: string; built?: { title: string; sections: number } | null; edited?: boolean; fields?: string[]; pending?: boolean; status?: string; error?: boolean }
interface PendingMedia { id: number; url: string; name: string; kind: 'image' | 'video'; status: 'uploading' | 'ready' | 'error'; error?: string }

const DOC_TYPES = /\.(pdf|docx|txt|md|markdown|html?|csv)$/i;
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const isVideoLink = (u: string) => /(youtube\.com|youtu\.be|vimeo\.com)\//i.test(u);

/** The editor's live page, when docked beside it. */
export interface LivePage {
  content(): PuckItem[];
  apply(items: PuckItem[], prefix: string, replaceAll: boolean): void;
  replaceBlock(id: string, items: PuckItem[]): void;
  /** The entry's own fields as the form holds them, and a way to change them. */
  fields?(): { fields: Record<string, any>; event_start?: string | null; event_end?: string | null; event_all_day?: boolean | null } | null;
  setFields?(patch: { fields: Record<string, unknown>; event_start?: string | null; event_end?: string | null; event_all_day?: boolean }): void;
}

/** The block selected in the editor, and the top-level section it is in. */
export interface Selection {
  item: PuckItem;
  top: PuckItem;
}

const TYPE_NAMES: Record<string, string> = { text: 'Paragraph', 'list-item': 'List item', 'media-text': 'Media & text', 'entry-title': 'Title', 'entry-image': 'Featured image', 'collection-items': 'Collection card' };
const typeName = (t: string) => TYPE_NAMES[t] ?? t.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
/** "Heading: Fall foliage…", from the block's first words. */
function blockLabel(item: PuckItem): string {
  const words = (i: PuckItem): string => {
    const a = i.props.attrs ?? {};
    const own = String(a.content ?? a.text ?? a.alt ?? '').replace(/<[^>]+>/g, '').trim();
    return own || (i.props.children ?? []).map(words).find(Boolean) || '';
  };
  const w = words(item);
  return `${typeName(item.type)}${w ? `: ${w.length > 40 ? `${w.slice(0, 40)}…` : w}` : ''}`;
}

export interface ComposerProps {
  entryId?: number;
  live?: LivePage;
  selection?: Selection | null;
  /** Panel chrome (docked in the editor). */
  onClose?: () => void;
  pinned?: boolean;
  onPin?: (pinned: boolean) => void;
}

export default function Composer({ entryId, live, selection, onClose, pinned, onPin }: ComposerProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  /** Id prefix of the blocks this conversation built (they are replaced on each update). */
  const [prefix, setPrefix] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [loaded, setLoaded] = useState(!entryId);
  const [message, setMessage] = useState('');
  // A new conversation's type: from the list it was opened from (/admin/compose/?type=event), else a page.
  const [type, setType] = useState(() => {
    const asked = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('type');
    return COMPOSABLE_TYPES.some((c) => c.type === asked) ? asked! : 'page';
  });
  const [replaceAll, setReplaceAll] = useState(false);
  const [media, setMedia] = useState<PendingMedia[]>([]);
  const [docs, setDocs] = useState<File[]>([]);
  const [links, setLinks] = useState<string[]>([]);
  const [linkDraft, setLinkDraft] = useState('');
  const [showLink, setShowLink] = useState(false);
  const [picking, setPicking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  // Targeted edits: the selected block (or its whole section), unless dismissed for this selection.
  const [scope, setScope] = useState<'block' | 'section'>('block');
  const [dismissed, setDismissed] = useState<string | null>(null);
  const selectedId = selection?.item.props.id ?? null;
  const targetItem = selection && dismissed !== selectedId ? (scope === 'section' ? selection.top : selection.item) : null;
  const fileInput = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!entryId) return;
    fetch(`/api/admin/compose?entryId=${entryId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (s) {
          setSessionId(s.id);
          setPrefix(s.prefix);
          setTurns(s.turns);
        }
        setLoaded(true);
      });
  }, [entryId]);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  const upload = async (file: File) => {
    const kind = file.type.startsWith('video/') ? 'video' : 'image';
    const temp = -Date.now() - Math.random();
    setMedia((m) => [...m, { id: temp, url: URL.createObjectURL(file), name: file.name, kind, status: 'uploading' }]);
    const body = new FormData();
    body.append('file', file);
    const res = await fetch('/api/admin/media', { method: 'POST', body });
    if (!res.ok) {
      const error = await res.text();
      setMedia((m) => m.map((x) => (x.id === temp ? { ...x, status: 'error', error } : x)));
      return;
    }
    const row = await res.json();
    setMedia((m) => m.map((x) => (x.id === temp ? { ...x, id: row.id, status: 'ready' } : x)));
  };
  const addFiles = (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (f.type.startsWith('image/') || VIDEO_TYPES.includes(f.type)) upload(f);
      else if (DOC_TYPES.test(f.name)) setDocs((d) => [...d, f]);
      else setTurns((t) => [...t, { role: 'assistant', text: `${f.name} isn't a supported file: use images, MP4/WebM/MOV videos, PDF, Word (.docx), text or Markdown.`, error: true }]);
    }
  };
  const addLinks = (text: string) => {
    const found = text.split(/\s+/).map((x) => x.trim()).filter((x) => /^https?:\/\/\S+$/i.test(x));
    if (found.length) setLinks((l) => [...new Set([...l, ...found])]);
    setLinkDraft('');
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (text) addLinks(text);
  };

  const uploading = media.some((m) => m.status === 'uploading');
  const ready = media.filter((m) => m.status === 'ready');
  const canSend = !busy && !uploading && (message.trim() || docs.length || ready.length || links.length);
  const first = !turns.some((t) => t.role === 'assistant' && t.built);
  const pageHasContent = !!live && live.content().length > 0;

  const send = async () => {
    if (!canSend) return;
    const attachments: Attachment[] = [...ready.map((m) => ({ kind: m.kind, label: m.name, src: m.kind === 'image' ? m.url : undefined })), ...docs.map((d) => ({ kind: 'doc', label: d.name })), ...links.map((l) => ({ kind: isVideoLink(l) ? 'video' : 'link', label: l }))];
    const body = new FormData();
    if (sessionId) body.append('sessionId', sessionId);
    if (entryId) body.append('entryId', String(entryId));
    body.append('type', type);
    body.append('message', message);
    for (const d of docs) body.append('docs', d);
    for (const m of ready) body.append('media', String(m.id));
    body.append('links', links.join('\n'));
    if (targetItem) {
      body.append('targetId', targetItem.props.id);
      body.append('targetLabel', blockLabel(targetItem));
      body.append('targetJson', JSON.stringify(targetItem));
    }
    if (live) {
      // What is on the page now, so Claude keeps hand edits and leaves other content alone.
      const content = live.content();
      const mine = prefix ? content.filter((i) => isComposed(i, prefix)) : [];
      if (mine.length) body.append('current', outline(mine));
      const f = live.fields?.();
      if (f) body.append('entryFields', JSON.stringify(f));
      body.append('other', replaceAll && first ? '' : outline(content.filter((i) => !mine.includes(i))));
    }
    const replace = replaceAll && first && !targetItem;
    setTurns((t) => [...t, { role: 'user', text: message, attachments, target: targetItem ? blockLabel(targetItem) : undefined }, { role: 'assistant', text: '', pending: true, status: 'Sending…' }]);
    setMessage('');
    setMedia([]);
    setDocs([]);
    setLinks([]);
    setBusy(true);
    const patchLast = (f: (t: ChatTurn) => ChatTurn) => setTurns((all) => [...all.slice(0, -1), f(all[all.length - 1])]);
    try {
      // The turn runs as a job on the server (it can take minutes); its progress is polled.
      const res = await fetch('/api/admin/compose', { method: 'POST', body });
      const started = await res.json().catch(async () => ({ error: await res.text() }));
      if (started.sessionId) setSessionId(started.sessionId);
      if (started.prefix) setPrefix(started.prefix);
      if (!res.ok || !started.jobId) throw new Error(started.error || `Could not start (${res.status}).`);
      const note = (text: string) => setTurns((all) => [...all.slice(0, -1), { role: 'assistant', text, error: true }, all[all.length - 1]]);
      for (const n of started.notes ?? []) note(n);
      let shownNotes = 0;
      let failures = 0;
      for (;;) {
        await new Promise((r) => setTimeout(r, 1200));
        let job: any;
        try {
          const poll = await fetch(`/api/admin/compose?job=${started.jobId}`, { cache: 'no-store' });
          if (poll.status === 404) throw new Error('The request was lost on the server. Try again.');
          if (!poll.ok) throw Object.assign(new Error(`status ${poll.status}`), { blip: true });
          job = await poll.json();
          failures = 0;
        } catch (e) {
          // A failed poll is usually a network blip, not the job failing; give up only after a minute of them.
          if (!(e as any).blip && !(e instanceof TypeError)) throw e;
          if (++failures >= 50) throw new Error('Lost contact with the server. Reload to see if the page was built.');
          continue;
        }
        if (job.progress) patchLast((t) => ({ ...t, status: job.progress }));
        if (job.say) patchLast((t) => ({ ...t, text: job.say }));
        for (const n of (job.notes ?? []).slice(shownNotes)) note(n);
        shownNotes = job.notes?.length ?? 0;
        if (job.status === 'error') throw new Error(job.error || 'Something went wrong.');
        if (job.status === 'done') {
          const msg = job.result ?? {};
          patchLast((t) => ({ ...t, pending: false, status: undefined, text: msg.reply || t.text, built: msg.title ? { title: msg.title, sections: msg.items?.length ?? 0 } : null, edited: !!msg.edit, fields: msg.fields ? Object.keys({ ...msg.fields.fields, ...(msg.fields.event_start !== undefined ? { start: 1 } : {}), ...(msg.fields.event_end !== undefined ? { end: 1 } : {}), ...(msg.fields.event_all_day !== undefined ? { all_day: 1 } : {}) }) : undefined }));
          if (msg.fields && live?.setFields) live.setFields(msg.fields);
          if (msg.entryId) location.href = `/admin/edit/${msg.entryId}/?compose=1`;
          else if (msg.edit && live) live.replaceBlock(msg.edit.targetId, msg.edit.items);
          else if (msg.items && live) live.apply(msg.items, msg.prefix, replace);
          break;
        }
      }
    } catch (e) {
      patchLast(() => ({ role: 'assistant', text: (e as Error).message, error: true }));
    } finally {
      setBusy(false);
    }
  };

  const chip = 'flex max-w-full items-center gap-1.5 rounded border border-admin-ink/10 bg-white px-1.5 py-0.5 text-[11px]';
  const badge = (kind: string) => (
    <span className={`rounded px-1 py-px text-[9px] font-semibold tracking-wider text-white uppercase ${kind === 'video' ? 'bg-admin-ink' : kind === 'doc' ? 'bg-admin-accent' : kind === 'image' ? 'bg-[#6b8f71]' : 'bg-admin-muted'}`}>{kind}</span>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-admin-bg text-admin-ink" onDragOver={(e) => (e.preventDefault(), setDragging(true))} onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)} onDrop={onDrop}>
      {(onClose || onPin) && (
        <div className="flex items-center gap-2 border-b border-admin-ink/10 bg-white px-3 py-2">
          <h2 className="text-lg">Compose</h2>
          <span className="text-[11px] text-admin-muted">with Claude</span>
          {entryId && turns.length > 0 && !busy && (
            <button
              type="button"
              className="ml-auto rounded border border-admin-ink/15 px-2 py-0.5 text-xs text-admin-muted hover:text-admin-ink"
              title="Start a new conversation for this page (the page stays as it is)"
              onClick={() => {
                if (!confirm('Start a new conversation? Claude starts fresh, without this conversation\'s messages and materials. The page stays as it is.')) return;
                setSessionId(null);
                setPrefix('');
                setTurns([]);
              }}
            >
              New conversation
            </button>
          )}
          {onPin && (
            <button type="button" onClick={() => onPin(!pinned)} aria-pressed={pinned} title={pinned ? 'Unpin from the sidebar' : 'Pin to the sidebar (stays open)'} className={`${entryId && turns.length > 0 && !busy ? '' : 'ml-auto '}rounded border px-2 py-0.5 text-xs ${pinned ? 'border-admin-accent bg-admin-accent/10 text-admin-accent' : 'border-admin-ink/15 text-admin-muted hover:text-admin-ink'}`}>
              {pinned ? 'Pinned' : 'Pin'}
            </button>
          )}
          {onClose && (
            <button type="button" onClick={onClose} className={`${onPin ? '' : 'ml-auto '}text-xs text-admin-muted hover:text-admin-accent`}>
              Close
            </button>
          )}
        </div>
      )}

      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {!loaded && <p className="text-xs text-admin-muted">Loading the conversation…</p>}
        {loaded && !turns.length && (
          <div className="rounded border border-dashed border-admin-ink/15 p-3 text-sm text-admin-muted">
            <p className="mb-2 font-medium text-admin-ink">{live ? 'Add sections to this page' : 'Describe the page you want'}</p>
            <p>Add documents, images, videos, video links and web links, and say what the page is for. Claude lays it out in the site's style; then ask for changes here, now or later.</p>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={t.role === 'user' ? 'ml-6' : 'mr-6'}>
            <div className={`rounded-lg px-3 py-2 text-sm ${t.role === 'user' ? 'bg-admin-ink text-white' : t.error ? 'bg-[#c4592a]/10 text-[#c4592a]' : 'bg-white shadow-[0_0_0_1px_rgba(26,26,46,0.08)]'}`}>
              {t.text && (t.role === 'assistant' && !t.error ? <Reply text={t.text} /> : <p className="whitespace-pre-wrap">{t.text}</p>)}
              {t.attachments?.length ? (
                <div className={`flex flex-wrap gap-1 ${t.text ? 'mt-2' : ''}`}>
                  {t.attachments.map((a, j) => (
                    <span key={j} className={`${chip} text-admin-ink`}>
                      {badge(a.kind)}
                      <span className="truncate">{a.label}</span>
                    </span>
                  ))}
                </div>
              ) : null}
              {t.target && <p className={`${t.text ? 'mt-2 ' : ''}text-[11px] opacity-70`}>Editing {t.target}</p>}
              {t.edited && <p className="mt-2 text-xs text-[#6b8f71]">Changed the selected block</p>}
              {!!t.fields?.length && <p className="mt-2 text-xs text-[#6b8f71]">Updated the details: {t.fields.map((k) => (k === 'seo' ? 'SEO' : k.replace(/_/g, ' '))).join(', ')}</p>}
              {t.built && <p className="mt-2 text-xs text-[#6b8f71]">{live ? 'Updated the page' : 'Built'}: {t.built.title}{t.built.sections ? ` (${t.built.sections} sections)` : ''}</p>}
              {t.pending && <p className="mt-1 animate-pulse text-xs text-admin-muted">{t.status}</p>}
            </div>
          </div>
        ))}
      </div>

      <div className={`border-t border-admin-ink/10 bg-white p-3 ${dragging ? 'ring-2 ring-admin-accent ring-inset' : ''}`}>
        {selection && live && (
          <div className="mb-2 flex items-center gap-1.5 text-[11px]">
            {targetItem ? (
              <>
                <span className="flex min-w-0 items-center gap-1 rounded border border-admin-accent/40 bg-admin-accent/10 px-1.5 py-0.5 text-[#8a5a1f]">
                  <span className="shrink-0 font-semibold">Editing</span>
                  <span className="truncate">{blockLabel(targetItem)}</span>
                  <button type="button" aria-label="Don't target the selection" className="ml-0.5 text-[#8a5a1f] hover:text-[#c4592a]" onClick={() => setDismissed(selectedId)}>
                    ×
                  </button>
                </span>
                {selection.top !== selection.item && (
                  <span className="flex shrink-0 overflow-hidden rounded border border-admin-ink/15">
                    {(['block', 'section'] as const).map((sc) => (
                      <button key={sc} type="button" onClick={() => setScope(sc)} className={`px-1.5 py-0.5 ${scope === sc ? 'bg-admin-ink text-white' : 'text-admin-muted'}`}>
                        {sc === 'block' ? 'Block' : 'Section'}
                      </button>
                    ))}
                  </span>
                )}
              </>
            ) : (
              <button type="button" className="text-admin-muted underline hover:text-admin-accent" onClick={() => setDismissed(null)}>
                Edit the selected {typeName(selection.item.type).toLowerCase()} instead
              </button>
            )}
          </div>
        )}
        {(media.length > 0 || docs.length > 0 || links.length > 0) && (
          <div className="mb-2 flex flex-wrap gap-1">
            {media.map((m) => (
              <span key={m.id} className={chip}>
                {m.kind === 'image' ? <img src={m.url} alt="" className="h-5 w-5 rounded object-cover" /> : badge('video')}
                <span className="max-w-32 truncate">{m.name}</span>
                {m.status === 'uploading' && <span className="text-admin-muted">…</span>}
                {m.status === 'error' && <span className="text-[#c4592a]" title={m.error}>failed</span>}
                <button type="button" aria-label={`Remove ${m.name}`} className="text-admin-muted hover:text-[#c4592a]" onClick={() => setMedia((x) => x.filter((y) => y !== m))}>
                  ×
                </button>
              </span>
            ))}
            {docs.map((d, i) => (
              <span key={`${d.name}-${i}`} className={chip}>
                {badge('doc')}
                <span className="max-w-32 truncate">{d.name}</span>
                <button type="button" aria-label={`Remove ${d.name}`} className="text-admin-muted hover:text-[#c4592a]" onClick={() => setDocs((x) => x.filter((y) => y !== d))}>
                  ×
                </button>
              </span>
            ))}
            {links.map((l) => (
              <span key={l} className={chip}>
                {badge(isVideoLink(l) ? 'video' : 'link')}
                <span className="max-w-40 truncate">{l}</span>
                <button type="button" aria-label={`Remove ${l}`} className="text-admin-muted hover:text-[#c4592a]" onClick={() => setLinks((x) => x.filter((y) => y !== l))}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {showLink && (
          <div className="mb-2 flex gap-1">
            <input
              autoFocus
              className="flex-1 rounded border border-admin-ink/15 px-2 py-1 text-xs outline-none focus:border-admin-accent"
              placeholder="https://… (YouTube and Vimeo links become videos)"
              value={linkDraft}
              onChange={(e) => setLinkDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addLinks(linkDraft);
                }
                if (e.key === 'Escape') setShowLink(false);
              }}
            />
            <button type="button" className="rounded border border-admin-ink/15 px-2 text-xs hover:border-admin-accent" onClick={() => addLinks(linkDraft)}>
              Add
            </button>
          </div>
        )}
        <textarea
          className="max-h-48 min-h-20 w-full resize-y rounded border border-admin-ink/15 p-2 text-sm outline-none focus:border-admin-accent"
          placeholder={targetItem ? 'What should change in the selected block? e.g. "Warmer, half as long"' : turns.length ? 'Ask for changes, e.g. "Shorter intro, and pull in our sponsors near the end"' : live ? 'What should these sections be about?' : 'e.g. A page for the Summer Music Festival: lineup from the PDF, the photos, the promo video, a ticket link and our sponsors.'}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault();
              addFiles(e.clipboardData.files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <button type="button" className="rounded border border-admin-ink/15 px-2 py-1 hover:border-admin-accent" onClick={() => fileInput.current?.click()}>
            Files
          </button>
          <button type="button" className="rounded border border-admin-ink/15 px-2 py-1 hover:border-admin-accent" onClick={() => setPicking(true)}>
            Media library
          </button>
          <button type="button" className="rounded border border-admin-ink/15 px-2 py-1 hover:border-admin-accent" onClick={() => setShowLink((v) => !v)}>
            Link
          </button>
          <input ref={fileInput} type="file" multiple hidden accept="image/*,video/mp4,video/webm,video/quicktime,.pdf,.docx,.txt,.md,.markdown,.html,.htm,.csv" onChange={(e) => (e.target.files && addFiles(e.target.files), (e.target.value = ''))} />
          {!live && !turns.length && (
            <label className="flex items-center gap-1 text-admin-muted" title="The content type Claude creates">
              Create as
              <select className="rounded border border-admin-ink/15 px-1 py-1 text-admin-ink" value={type} onChange={(e) => setType(e.target.value)}>
                {COMPOSABLE_TYPES.map((c) => (
                  <option key={c.type} value={c.type}>
                    {c.singular}
                  </option>
                ))}
              </select>
            </label>
          )}
          {live && first && pageHasContent && !targetItem && (
            <label className="flex items-center gap-1 text-admin-muted">
              <input type="checkbox" checked={replaceAll} onChange={(e) => setReplaceAll(e.target.checked)} />
              Replace what's on the page
            </label>
          )}
          <button type="button" disabled={!canSend} onClick={send} className="ml-auto rounded-sm bg-admin-ink px-4 py-1.5 font-semibold tracking-wider text-white uppercase hover:bg-admin-accent disabled:opacity-40">
            {busy ? 'Working…' : 'Send'}
          </button>
        </div>
      </div>

      {picking && (
        <MediaModal
          multiple
          onClose={() => setPicking(false)}
          onSelectMany={(list) => {
            setMedia((x) => [...x, ...list.filter((m) => m.mediaId && !x.some((y) => y.id === m.mediaId)).map((m) => ({ id: m.mediaId!, url: m.url, name: m.name ?? 'media', kind: m.kind ?? 'image', status: 'ready' as const }))]);
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}
