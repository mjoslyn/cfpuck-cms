// The settings panel's trail: Page, then every block the selected one sits inside, each a button that
// selects it (Page shows the page's own settings). Puck's own breadcrumbs show only the nearest parent,
// so a block deep in a section had no way back to the page's settings. Rendered by the `fields`
// override; on the desktop panel it takes the place of Puck's breadcrumbs, above the block's name.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createUsePuck, useGetPuck } from '@puckeditor/core';
import { ancestorsOf } from '../lib/puck/trail';

const usePuck = createUsePuck();

export function FieldsTrail({ children }: { children: ReactNode }) {
  const getPuck = useGetPuck();
  const selectedId = usePuck((s) => (s.selectedItem?.props as { id?: string } | undefined)?.id);
  const data = usePuck((s) => s.appState.data);
  const config = usePuck((s) => s.config);
  const anchor = useRef<HTMLSpanElement>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  // On the desktop panel, a place for the trail at the start of Puck's breadcrumb row.
  useLayoutEffect(() => {
    const row = anchor.current?.closest('[class*="_SidebarSection_"]')?.querySelector<HTMLElement>('[class*="_SidebarSection-breadcrumbs_"]');
    if (!row) return setSlot(null);
    let el = row.querySelector<HTMLElement>(':scope > .cms-trail');
    if (!el) {
      el = document.createElement('div');
      el.className = 'cms-trail';
      row.prepend(el);
    }
    setSlot(el);
  }, []);

  const { getSelectorForId, getItemById, dispatch } = getPuck();
  const ids = selectedId ? ancestorsOf(selectedId, (id) => getSelectorForId(id)?.zone) : [];
  void data; // re-render when the page changes, so a moved block's trail follows it
  const label = (type: string) => (config.components as Record<string, { label?: string }>)[type]?.label ?? type;
  const select = (id: string | null) => dispatch({ type: 'setUi', ui: { itemSelector: id ? getSelectorForId(id) ?? null : null } });

  const trail = selectedId ? (
    <nav aria-label="Where this block is" className="cms-trail__list">
      <button type="button" onClick={() => select(null)} title="The page's own settings">
        {config.root?.label || 'Page'}
      </button>
      {ids.map((id) => {
        const item = getItemById(id);
        return item ? (
          <button key={id} type="button" onClick={() => select(id)}>
            {label(item.type as string)}
          </button>
        ) : null;
      })}
    </nav>
  ) : null;

  return (
    <>
      <span ref={anchor} hidden />
      {slot ? trail && createPortal(trail, slot) : trail && <div className="cms-trail cms-trail--inline">{trail}</div>}
      {children}
    </>
  );
}
