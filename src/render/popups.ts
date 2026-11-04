// Popups on a page (src/lib/popups.ts): each its template part in a .c-popup wrapper, hidden until
// public/assets/js/popups.js shows it; the consent banner with its Accept and Reject buttons, styled alike.
import type { PuckItem } from '../lib/puck/types';
import type { Popup } from '../lib/popups';
import type { Env } from './env';
import { renderItems } from './engine';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The part block that holds a popup's content (prepared and rendered with the page's own blocks). */
export const popupItem = (p: Popup): PuckItem => ({ type: 'part', props: { id: `popup-${p.id}-part`, attrs: { slug: p.part, tag: 'div', className: 'c-popup__content' } } }) as PuckItem;

export function renderPopup(p: Popup, env: Env): string {
  const content = renderItems([popupItem(p)], env);
  // A popup whose part is missing or empty shows nothing; a consent banner still offers its choice.
  if (!content && !p.consent) return '';
  const settings = { id: p.id, trigger: p.trigger, delay: p.delay, scroll: p.scroll, frequency: p.frequency, days: p.days, consent: p.consent || undefined };
  const modal = p.layout === 'modal';
  const actions = p.consent
    ? `<div class="c-popup__actions"><div class="c-button"><button type="button" class="c-button__link" data-consent-choice="all">${esc(p.acceptLabel ?? 'Accept')}</button></div><div class="c-button"><button type="button" class="c-button__link" data-consent-choice="necessary">${esc(p.rejectLabel ?? 'Reject')}</button></div>${p.policyUrl ? `<a class="c-popup__policy" href="${esc(p.policyUrl)}">${esc(p.policyLabel ?? 'Privacy policy')}</a>` : ''}</div>`
    : '';
  const closer = p.consent ? '' : '<button type="button" class="c-popup__close" aria-label="Close" data-popup-close><span aria-hidden="true">&times;</span></button>';
  return `<div class="c-popup is-${p.layout}${p.consent ? ' is-consent' : ''}" id="popup-${p.id}" data-popup="${esc(JSON.stringify(settings))}" role="dialog" aria-label="${esc(p.name)}"${modal ? ' aria-modal="true"' : ''} hidden>${modal && !p.consent ? '<div class="c-popup__backdrop" data-popup-close></div>' : modal ? '<div class="c-popup__backdrop"></div>' : ''}<div class="c-popup__box" tabindex="-1">${closer}${content}${actions}</div></div>`;
}
