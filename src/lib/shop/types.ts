// The Shop feature's content type and taxonomy (Settings > Shop, src/lib/shop/config.ts). The core adds
// them to the site's config (src/lib/site), as Events adds its own, so a site needs neither in its
// config.ts. A site changes them with its config's `shop` (fields added, replaced or left out; labels,
// URLs...); one that lists its own `product` type or `product_category` taxonomy keeps that whole, and
// keeps it shown while the shop is off. Safe in the browser.
import type { ContentType, ShopConfig, Taxonomy } from '../site/types';
import { extendType } from '../events/types';

export const PRODUCT_TYPE: ContentType = {
  type: 'product',
  label: 'Products',
  singular: 'Product',
  base: 'product',
  archive: '/shop/',
  category: 'product_category',
  describe: 'a product for sale in the shop (/shop/): its own page with the price and Add to cart beside your content',
  card: 'product',
  fields: [],
};

export const PRODUCT_CATEGORY: Taxonomy = { name: 'product_category', label: 'Product categories', singular: 'Product category', base: 'shop/category' };

/**
 * The site's types and taxonomies with the shop's added, and which of them are the core's: those are
 * hidden while the shop is off (a site's own `product` type stays, the shop's settings added to it).
 */
export function withShop(types: ContentType[], taxonomies: Taxonomy[], ext: ShopConfig = {}): { types: ContentType[]; taxonomies: Taxonomy[]; coreTypes: string[]; coreTaxonomies: string[] } {
  const own = types.some((t) => t.type === PRODUCT_TYPE.type);
  const add = own ? [] : [extendType(PRODUCT_TYPE, ext.product)];
  // Before the first type without a page (records, globals), so the admin keeps pages first.
  const at = types.findIndex((t) => t.record || t.pageless);
  const merged = at < 0 ? [...types, ...add] : [...types.slice(0, at), ...add, ...types.slice(at)];
  const product = merged.find((t) => t.type === PRODUCT_TYPE.type)!;
  const wanted = !own && product.category === PRODUCT_CATEGORY.name && !taxonomies.some((t) => t.name === PRODUCT_CATEGORY.name);
  return {
    types: merged,
    taxonomies: wanted ? [...taxonomies, { ...PRODUCT_CATEGORY, ...ext.category, name: PRODUCT_CATEGORY.name }] : taxonomies,
    coreTypes: own ? [] : [PRODUCT_TYPE.type],
    coreTaxonomies: wanted ? [PRODUCT_CATEGORY.name] : [],
  };
}
