// Copy styles / Paste styles in every block's settings (src/lib/content/style-copy.ts). The copy is
// kept in the browser, so it can be pasted in another page, template, part or pattern.
import { useEffect, useState } from 'react';
import { copyStyle, pasteStyle, takesStyle, type CopiedStyle } from '../lib/content/style-copy';

const KEY = 'cms.copiedStyle';
const EVENT = 'cms:copied-style';

function stored(): (CopiedStyle & { label: string }) | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && typeof v.type === 'string' && v.attrs && typeof v.attrs === 'object' ? v : null;
  } catch {
    return null;
  }
}

export function StyleCopy({ type, label, value, onChange }: { type: string; label: string; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const [copied, setCopied] = useState(stored);
  const [status, setStatus] = useState('');
  useEffect(() => {
    const update = () => setCopied(stored());
    window.addEventListener('storage', update);
    window.addEventListener(EVENT, update);
    return () => (window.removeEventListener('storage', update), window.removeEventListener(EVENT, update));
  }, []);
  if (!takesStyle(type, value)) return null;
  const copy = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...copyStyle(type, value), label }));
    } catch {
      return setStatus('Could not keep the copy in this browser.');
    }
    window.dispatchEvent(new Event(EVENT));
    setStatus(`Copied this ${label.toLowerCase()}'s styles.`);
  };
  const paste = () => {
    if (!copied) return;
    onChange(pasteStyle(type, value, copied));
    setStatus(copied.type === type ? `Pasted the styles from a ${copied.label.toLowerCase()}.` : `Pasted the colours, spacing, type and borders from a ${copied.label.toLowerCase()}.`);
  };
  const button = 'rounded border border-admin-ink/15 bg-white px-2 py-1 text-xs hover:border-admin-accent hover:text-admin-accent disabled:opacity-40 disabled:hover:border-admin-ink/15 disabled:hover:text-current';
  return (
    <div className="mt-4 border-t border-admin-ink/10 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={button} onClick={copy} title="Copy this block's colours, spacing, type, borders and layout">
          Copy styles
        </button>
        <button type="button" className={button} disabled={!copied} onClick={paste} title={copied ? `Paste the styles copied from a ${copied.label.toLowerCase()}` : 'Copy a block\'s styles first'}>
          Paste styles{copied ? ` from ${copied.label.toLowerCase()}` : ''}
        </button>
      </div>
      {status && (
        <p className="mt-2 text-xs text-[#3f7a3f]" role="status">
          {status}
        </p>
      )}
    </div>
  );
}
