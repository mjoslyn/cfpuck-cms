// The editors' right panel (the page's and blocks' settings) can be hidden for a wider canvas: a
// labelled button in the header (Puck's own toggle is an unlabelled icon at the far left), and the
// choice is remembered per browser.
import { useEffect } from 'react';
import { createUsePuck, useGetPuck } from '@puckeditor/core';

const usePuck = createUsePuck();
const KEY = 'cms-right-panel';

/** Puck's starting UI: the right panel hidden if it was hidden last time. Read once per editor. */
export function rightPanelUi(): { rightSideBarVisible?: boolean } {
  try {
    return localStorage.getItem(KEY) === 'hidden' ? { rightSideBarVisible: false } : {};
  } catch {
    return {};
  }
}

/** Hide or show the right panel; inside Puck (a header override). */
export function RightPanelToggle() {
  const visible = usePuck((s) => s.appState.ui.rightSideBarVisible);
  const getPuck = useGetPuck();
  // Remembered whichever toggle changed it, this one or Puck's.
  useEffect(() => {
    try {
      localStorage.setItem(KEY, visible ? 'shown' : 'hidden');
    } catch {}
  }, [visible]);
  return (
    <button
      type="button"
      onClick={() => getPuck().dispatch({ type: 'setUi', ui: { rightSideBarVisible: !visible } })}
      aria-pressed={!visible}
      title={visible ? 'Hide the settings panel for a wider canvas' : 'Show the settings panel'}
      className="flex items-center gap-1 whitespace-nowrap rounded border border-admin-ink/15 px-2 py-1.5 text-sm text-admin-muted hover:border-admin-accent hover:text-admin-accent"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
        <path d="M14.5 4.5v15" />
        {visible ? <path d="M8 10l2 2-2 2" /> : <path d="M10 10l-2 2 2 2" />}
      </svg>
      {visible ? 'Hide settings' : 'Settings'}
    </button>
  );
}
