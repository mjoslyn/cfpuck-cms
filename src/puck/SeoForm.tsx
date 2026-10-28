// The SEO section of an entry's settings: search title and description (with lengths and a search
// result preview), share image, noindex, and Compose (a suggestion from Claude for the page as it
// is now). Stored in fields.seo; editing it by hand stops Compose rewriting it (src/lib/seo.ts).
import { useState } from 'react';
import { MediaPicker, Row, Toggle, inputClass } from './fields';
import { SEO_LIMITS, itemsText, seoOf, summary, type Seo } from '../lib/seo';
import { site } from '../lib/site';

function Count({ n, max }: { n: number; max: number }) {
  return <span className={`ml-2 text-[11px] ${n > max ? 'text-[#b3261e]' : 'text-admin-muted'}`}>{n}/{max}</span>;
}

export function SeoForm({ type, title, excerpt, fields, path, pageItems, entry = false, onChange }: {
  type: string;
  title: string;
  excerpt: string;
  fields: Record<string, any>;
  path: string;
  pageItems?: () => any[];
  /** An entry (not a term page): offers leaving it out of the site's search. */
  entry?: boolean;
  onChange: (fields: Record<string, any>) => void;
}) {
  const seo = seoOf(fields);
  const [status, setStatus] = useState('');
  // Any hand edit keeps Compose from rewriting it.
  const set = (patch: Partial<Seo>) => {
    const next: Seo = { ...seo, ...patch };
    delete next.generated;
    for (const k of Object.keys(next) as (keyof Seo)[]) if (next[k] === '' || next[k] === undefined || next[k] === false) delete next[k];
    const out = { ...fields };
    if (Object.keys(next).length) out.seo = next;
    else delete out.seo;
    onChange(out);
  };
  const generate = async () => {
    setStatus('Writing a suggestion…');
    const res = await fetch('/api/admin/seo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, title, text: [summary(excerpt, 1000), itemsText(pageItems?.())].filter(Boolean).join('\n\n') }) });
    if (!res.ok) return setStatus(await res.text());
    const s = await res.json();
    set({ title: s.title, description: s.description });
    setStatus('Suggestion added. Edit it as you like.');
  };
  const shownTitle = seo.title || summary(title, 200);
  const shownDescription = seo.description || summary(excerpt) || 'A description from the page excerpt shows here.';
  return (
    <div>
      <Row title="Search title">
        <input className={inputClass} value={seo.title ?? ''} placeholder={summary(title, 200)} onChange={(e) => set({ title: e.target.value })} />
        <Count n={(seo.title ?? '').length} max={SEO_LIMITS.title} />
      </Row>
      <Row title="Meta description">
        <textarea className={inputClass} rows={4} value={seo.description ?? ''} placeholder="From the excerpt when left empty" onChange={(e) => set({ description: e.target.value })} />
        <Count n={(seo.description ?? '').length} max={SEO_LIMITS.description} />
      </Row>
      <button type="button" onClick={generate} className="mb-2 rounded-sm border border-admin-ink/20 px-3 py-1.5 text-xs font-semibold hover:border-admin-ink/50">
        Compose
      </button>
      {status && <p className="mb-2 text-xs text-admin-muted" role="status">{status}</p>}
      {seo.generated && <p className="mb-2 text-xs text-admin-muted">Written by Compose; it updates when Compose rebuilds the page until you edit it.</p>}
      <div className="mb-3 rounded border border-admin-ink/10 bg-white p-3" aria-label="Search result preview">
        <p className="truncate text-[11px] text-[#475569]">{path}</p>
        <p className="truncate text-sm text-[#1a0dab]">{shownTitle} – {site.name}</p>
        <p className="line-clamp-2 text-xs text-[#475569]">{shownDescription}</p>
      </div>
      <MediaPicker title="Share image" url={seo.image_url} onSelect={(m) => set({ image: m.id ?? m.mediaId ?? undefined, image_url: m.url })} />
      <p className="-mt-2 mb-3 text-xs text-admin-muted">Shown when the page is shared. The featured image, then the site's default, when empty.</p>
      {!!seo.image && (
        <button type="button" className="mb-3 text-xs text-[#b3261e]" onClick={() => set({ image: undefined, image_url: undefined })}>
          Remove share image
        </button>
      )}
      <Toggle title="Hide from search engines and AI answer engines" value={!!seo.noindex} onChange={(v) => set({ noindex: v })} />
      <p className="-mt-2 mb-3 text-xs text-admin-muted">Asks Google, Bing and the like not to list this page (noindex), and the crawlers behind ChatGPT, Claude, Perplexity, Google's AI answers and others not to read it (robots.txt), once published. Crawlers that ignore these requests aren't stopped.</p>
      {entry && (
        <>
          <Toggle title="Leave out of this site's search" value={!!seo.nosearch} onChange={(v) => set({ nosearch: v || undefined })} />
          <p className="-mt-2 mb-3 text-xs text-admin-muted">The site's search page and search box won't list it. It still shows in menus and lists, and to search engines unless noindex is on too.</p>
        </>
      )}
    </div>
  );
}
