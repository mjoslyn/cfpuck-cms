// The shop's starter templates: a product's page (its image beside its name, Add to cart and excerpt,
// its content below) and the shop's listing (/shop/: the products as cards). Made when the shop is
// first turned on (Settings > Shop) and by scripts/seed.ts, unless templates with those addresses are
// there already; edit them under Templates.
import type { Db } from '../db/query';
import type { PuckItem } from '../puck/types';
import { cardTemplate } from '../content/card-presets';

const node = (id: string, type: string, attrs: Record<string, any> = {}, children?: PuckItem[]): PuckItem =>
  ({ type, props: { id: `t-shop-${id}`, attrs, ...(children ? { children } : {}) } }) as PuckItem;
const pad = { top: 'var(--space-70)', right: 'var(--space-50)', bottom: 'var(--space-80)', left: 'var(--space-50)' };

export const SHOP_TEMPLATES: Record<string, { title: string; content: PuckItem[] }> = {
  'single-product': {
    title: 'Product',
    content: [
      node('header', 'part', { slug: 'header' }),
      node('main', 'section', { tag: 'main', style: { padding: pad }, layout: { type: 'constrained', contentSize: '1280px' }, gap: 'var(--space-70)' }, [
        node('columns', 'columns', { gap: { row: 'var(--space-50)', column: 'var(--space-70)' } }, [
          node('image-column', 'column', {}, [node('image', 'entry-image', { size: 'large', style: { radius: '6px' } })]),
          node('buy-column', 'column', {}, [
            node('buy', 'section', { layout: { type: 'flow' }, gap: 'var(--space-40)' }, [
              node('title', 'entry-title', { level: 1, style: { fontFamily: 'var(--font-display)' } }),
              node('excerpt', 'entry-excerpt', {}),
              node('add', 'add-to-cart', {}),
            ]),
          ]),
        ]),
        node('content', 'entry-content', { layout: { type: 'constrained', contentSize: '720px' } }),
      ]),
      node('footer', 'part', { slug: 'footer' }),
    ],
  },
  'archive-product': {
    title: 'Shop',
    content: [
      node('header', 'part', { slug: 'header' }),
      node('main', 'section', { tag: 'main', style: { padding: pad }, layout: { type: 'constrained', contentSize: '1280px' }, gap: 'var(--space-60)' }, [
        node('title', 'archive-title', { kind: 'archive', level: 1, showPrefix: false, style: { fontFamily: 'var(--font-display)' } }),
        node('products', 'collection', { query: { inherit: true, perPage: 24, postType: 'product', order: 'asc', orderBy: 'title' }, display: 'grid', columns: 3, columnsTablet: 2, columnsPhone: 1, card: 'product', appliedCard: 'product', pagination: 'numbers', emptyText: 'Nothing in the shop yet.' }, [
          node('product-items', 'collection-items', {}, cardTemplate('product', 't-shop-card')),
        ]),
      ]),
      node('footer', 'part', { slug: 'footer' }),
    ],
  },
};

/** Make the shop's templates that aren't there yet, as the server. The slugs made. */
export async function ensureShopTemplates(db: Db): Promise<string[]> {
  const made: string[] = [];
  for (const [slug, t] of Object.entries(SHOP_TEMPLATES)) {
    const { data } = await db.from('templates').select('id').eq('kind', 'template').eq('slug', slug).maybeSingle();
    if (data) continue;
    const { error } = await db.from('templates').insert({ kind: 'template', slug, title: t.title, content: { root: { props: {} }, content: t.content, zones: {} } });
    if (error) throw error;
    made.push(slug);
  }
  return made;
}
