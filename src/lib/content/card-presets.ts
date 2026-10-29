// Card designs for collections: the item template a collection repeats for each entry. The designs
// come from the site (src/site/lib/content/cards.ts, through SiteRender.cards); picking one in the collection's
// settings replaces its template, and "custom" keeps the blocks as edited.
import type { PuckItem } from '../puck/types';
import type { CardPreset, CardTemplate } from '../site/extend';
import { SITE_RENDER } from '../site/render';

export type { CardPreset };

/** The shop's card (Settings > Shop) for a site without its own `product` design: the image, name and price. */
const PRODUCT_CARD: CardPreset = {
  id: 'product',
  label: 'Product: image, name and price',
  description: 'The product\'s image, its name and its price (the shop).',
  template: [
    {
      type: 'section',
      props: {
        attrs: { gap: 'var(--space-20)', layout: { type: 'stack' }, className: 'c-product-card' },
        children: [
          { type: 'entry-image', props: { attrs: { link: true, size: 'medium_large', imgWidth: '100%', aspectRatio: '1/1', style: { radius: '6px' } } } },
          { type: 'entry-title', props: { attrs: { level: 3, link: true } } },
          { type: 'product-price', props: { attrs: {} } },
        ],
      },
    },
  ],
};

const SITE_CARDS = SITE_RENDER.cards ?? [];
export const CARD_PRESETS: CardPreset[] = SITE_CARDS.some((c) => c.id === PRODUCT_CARD.id) ? SITE_CARDS : [...SITE_CARDS, PRODUCT_CARD];
/** The design new collections start with. */
export const DEFAULT_CARD = CARD_PRESETS[0]?.id ?? 'custom';
export const CARD_IDS = CARD_PRESETS.map((p) => p.id);

/** A preset's template with fresh block ids (Puck needs them unique). */
export function cardTemplate(id: string, prefix: string): PuckItem[] {
  const preset = CARD_PRESETS.find((p) => p.id === id);
  let n = 0;
  const copy = (items: CardTemplate[]): PuckItem[] =>
    items.map(
      (i) =>
        ({
          type: i.type,
          props: {
            id: `${prefix}-${i.type}-${n++}`,
            attrs: structuredClone(i.props.attrs),
            ...(i.props.children ? { children: copy(i.props.children) } : {}),
          },
        }) as PuckItem,
    );
  return preset ? copy(preset.template) : [];
}
