// Regression tests for markup, headers, links and paths that come from people or from Claude.
import { describe, expect, it, vi } from 'vitest';
import { trimWords } from '../src/render/html';
import { part } from '../src/render/c/structure';
import { entryTitleBlock } from '../src/render/c/entry';
import { urlVariables } from '../src/lib/mailing/render';
import { sendMail } from '../src/lib/forms/mail';
import { allowed } from '../src/lib/sync-remote';
import { parseRange, unsafeKey } from '../src/lib/storage';

const block = (type: string, attrs: Record<string, unknown>) => ({ id: 'b1', type, attrs, children: [] }) as any;
const inner = Object.assign(() => '', { each: () => [] });

describe('rendering', () => {
  it('escapes a "<" an unclosed tag leaves in an excerpt', () => {
    expect(trimWords('Tom <img/src=x/onerror=alert(1)// end', 55)).toBe('Tom &lt;img/src=x/onerror=alert(1)// end');
    expect(trimWords('Body with <em>emphasis</em>.', 55)).toBe('Body with emphasis.');
  });

  it('keeps a heading level a number from 1 to 6', () => {
    const env = { post: { id: 1, type: 'page', slug: 'x', title: 'T', title_rendered: 'T', fields: {} }, ctx: {} } as any;
    const title = (level: unknown) => entryTitleBlock(block('entry-title', { level }), env, inner);
    expect(title('1 onmouseover=alert(1)')).toBe('<h2 class="c-entry-title">T</h2>');
    expect(title(9)).toMatch(/^<h6 /);
    expect(title(0)).toMatch(/^<p /);
  });

  it('takes a part’s tag from a list and escapes its class', () => {
    const env = { ctx: { docs: new Map([['part:header', [{ type: 'spacer', props: { id: 's', attrs: {} } }]]]), rendered: [] }, post: null } as any;
    const html = part(block('part', { slug: 'header', tag: 'img src=x onerror=alert(1)', className: 'x" onmouseover="alert(1)' }), env, inner);
    expect(html.startsWith('<header class="c-part is-header x&quot; onmouseover=&quot;alert(1)"')).toBe(true);
  });
});

describe('email', () => {
  it('puts a recipient’s value into an address URL-encoded, and never at its start', () => {
    expect(urlVariables('<a href="https://x.org/?n=%recipient.v1_h%">y</a>')).toBe('<a href="https://x.org/?n=%recipient.v1_u%">y</a>');
    expect(urlVariables('<a href="%recipient.v1%">x</a>')).toBe('<a>x</a>');
    expect(urlVariables('<a href=" %recipient.v1_h%">x</a>')).toBe('<a>x</a>');
  });

  it('keeps line breaks out of the subject, sender and addresses', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await sendMail({ to: ['a@b.org\r\nBcc: c@d.org'], subject: 'Hi\r\nBcc: evil@x.org\r\n\r\nbody', html: '<p>x</p>', fromName: 'Site\nX-Evil: 1' });
    const line = String(warn.mock.calls[0]?.[0]);
    warn.mockRestore();
    expect(line).toContain('Hi Bcc: evil@x.org body');
    expect(line).not.toMatch(/[\r\n]/);
  });
});

describe('sync and storage', () => {
  const query = (table: string, columns: string) => ({ query: { table, columns, filters: [], order: [], action: 'select' } as any });

  it('takes a sync query only on the tables a sync uses, embeds included', () => {
    expect(allowed(query('entries', '*'))).toBe(true);
    expect(allowed(query('entries', 'entry_terms(terms(*))'))).toBe(true);
    expect(allowed(query('users', '*'))).toBe(false);
    expect(allowed(query('entries', '*, revisions(users(accounts(password)))'))).toBe(false);
    expect(allowed(query('entries', 'x:revisions(*)'))).toBe(false);
  });

  it('refuses keys that leave their folder', () => {
    for (const key of ['../compose/x', '../../other/x', 'a/./b', '/abs', 'a\\b', '..']) expect(unsafeKey(key), key).toBe(true);
    expect(unsafeKey('2026/10/photo.jpg')).toBe(false);
  });

  it('reads a Range against the file’s size', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ offset: 0, length: 100 });
    expect(parseRange('bytes=-5000', 1000)).toEqual({ offset: 0, length: 1000 });
    expect(parseRange('bytes=900-', 1000)).toEqual({ offset: 900, length: 100 });
    expect(parseRange('bytes=99999999-', 1000)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-1,5-6', 1000)).toBeNull();
    expect(parseRange('items=0-1', 1000)).toBeNull();
  });
});
