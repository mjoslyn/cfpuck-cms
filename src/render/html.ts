// HTML string helpers shared by the block renderers.

/** Escape text and attribute values, without double-encoding existing entities. */
export const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&(?!(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);)/gi, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

/** Interleave saved markup chunks with rendered inner blocks. */
export function interleave(chunks: string[], children: string[]): string {
  if (chunks.length === children.length + 1) {
    let out = chunks[0];
    children.forEach((c, i) => (out += c + chunks[i + 1]));
    return out;
  }
  // Inner blocks were added/removed in the editor: keep the wrapper, drop stale separators.
  if (chunks.length <= 1) return (chunks[0] ?? '') + children.join('');
  return chunks[0] + children.join('\n\n') + chunks[chunks.length - 1];
}

/** Add classes to the first tag. */
export function addClassToFirstTag(html: string, classes: string[]): string {
  const add = classes.filter(Boolean);
  if (!add.length) return html;
  return html.replace(/<([a-zA-Z][\w-]*)((?:\s[^>]*)?)>/, (_m, tag: string, rest: string) => {
    const cls = rest.match(/\sclass=(["'])(.*?)\1/);
    if (cls) {
      const existing = cls[2].split(/\s+/).filter(Boolean);
      const merged = [...existing, ...add.filter((c) => !existing.includes(c))].join(' ');
      return `<${tag}${rest.replace(cls[0], ` class="${merged}"`)}>`;
    }
    return `<${tag} class="${add.join(' ')}"${rest}>`;
  });
}

/** get_block_wrapper_attributes() output: `style="..." class="..."` */
export function wrapperAttrs(w: { className: string; style: string }, extra = '') {
  return `${w.style ? `style="${esc(w.style)}" ` : ''}class="${esc(w.className)}"${extra}`;
}

/** Strip tags and trim to a number of words. */
export function trimWords(text: string, num: number, more = '&hellip;') {
  // A "<" left after the tags go (one never closed) would start markup of its own where the words go.
  const stripped = text.replace(/<(script|style)[^>]*?>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, '').replace(/</g, '&lt;').trim();
  const words = stripped.split(/[\n\r\t ]+/).filter(Boolean);
  return words.length > num ? words.slice(0, num).join(' ') + more : words.join(' ');
}
