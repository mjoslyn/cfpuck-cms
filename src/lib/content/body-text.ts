// An entry's readable text (entries.body_text, for search and event descriptions), from its content:
// every block's text settings (eyebrow, title, content, text, question, answer, citation, caption,
// html, then a list's items; for a linked pattern, the text this page put in it, its overrides), in
// document order, tags stripped and a few entities read, spaces
// collapsed. What the database's entry_body_text() did in Postgres; the query layer fills it on every
// write of `content` (src/lib/db/sqlite.ts). Objects are walked as jsonb ordered their keys (shorter
// first, then by bytes), so the text reads the same as before.

const KEYS = ['eyebrow', 'title', 'content', 'text', 'question', 'answer', 'citation', 'caption', 'html'];

const byJsonbOrder = (a: string, b: string) => {
  const la = new TextEncoder().encode(a);
  const lb = new TextEncoder().encode(b);
  if (la.length !== lb.length) return la.length - lb.length;
  for (let i = 0; i < la.length; i++) if (la[i] !== lb[i]) return la[i] - lb[i];
  return 0;
};

/** Every object that has `attrs`, depth first, each before what it holds. */
function nodesWithAttrs(value: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) for (const v of value) nodesWithAttrs(v, out);
  else if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if ('attrs' in o) out.push(o);
    for (const k of Object.keys(o).sort(byJsonbOrder)) nodesWithAttrs(o[k], out);
  }
  return out;
}

export function bodyText(doc: unknown): string {
  const parts: string[] = [];
  for (const node of nodesWithAttrs(doc ?? {})) {
    const attrs = node.attrs as Record<string, unknown> | null;
    if (!attrs || typeof attrs !== 'object') continue;
    for (const k of KEYS) if (typeof attrs[k] === 'string') parts.push(attrs[k] as string);
    if (Array.isArray(attrs.items)) for (const i of attrs.items) if (i && typeof (i as { content?: unknown }).content === 'string') parts.push((i as { content: string }).content);
    // The pattern's own text is in the pattern (not read at write time); the page's is here.
    const overrides = attrs.linked === true && attrs.overrides && typeof attrs.overrides === 'object' ? (attrs.overrides as Record<string, unknown>) : null;
    for (const id of Object.keys(overrides ?? {}).sort(byJsonbOrder)) {
      const o = overrides![id] as Record<string, unknown> | null;
      if (o && typeof o === 'object') for (const k of KEYS) if (typeof o[k] === 'string') parts.push(o[k] as string);
    }
  }
  return parts
    .join(' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;|&rsquo;|&#8216;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#8211;/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}
