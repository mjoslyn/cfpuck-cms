// The shop's blocks (Settings > Shop, src/lib/shop/config.ts): a product's price, Add to cart (its
// options, quantity and button), the cart, and a cart link with the number of items. The cart is kept
// in the visitor's browser (public/assets/js/cart.js), so pages with these blocks stay cached and
// shared: the script adds to the cart, fills the cart from the server's prices (POST /api/shop/quote)
// and corrects what's left from GET /api/shop/availability, since a cached page can be a minute old.
import type { Env, Renderer } from '../env';
import type { Entry } from '../../lib/types';
import { esc } from '../html';
import { attrs, escAttr, styleDecls } from './style';
import { formatMoney } from '../../lib/payments/money';
import { downsize, mediaUrl } from '../../lib/media/image';
import { CART_PATH, maxQuantity, priceRange, productOf, sellable, shopSettings, type Product } from '../../lib/shop/config';
import { leftOf, type StockMap } from '../../lib/shop/stock';
import { ARCHIVE_PATHS } from '../../lib/site';

/** Where prepare keeps the stock of the products on the page. */
export const STOCK_KEY = 'shop-stock';
export const CART_SCRIPT = '<script src="/assets/js/cart.js" defer></script>';

/** A JSON value in an attribute (every & escaped, so text that looks like an entity stays as it is). */
const jsonAttr = (v: unknown) => JSON.stringify(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const root = (a: Record<string, any>, base: string[]) => attrs([...base, a.className], styleDecls(a.style), { id: a.anchor });
const note = (env: Env, text: string) => (env.ctx.editor ? `<div class="cms-editor-note">${esc(text)}</div>` : '');

/** The product a block shows: the one it names, else the entry in context (a product's page, a card). */
function productEntry(b: { attrs: Record<string, any> }, env: Env): Entry | undefined {
  const id = Number(b.attrs.product) || 0;
  const e = id ? env.ctx.loader.entries.get(id) : (env.post ?? undefined);
  return e?.type === 'product' ? e : undefined;
}

const currency = (env: Env) => shopSettings(env.ctx.settings.site).currency;

/** A price, struck through beside its compare-at price when that is higher. */
function priceHtml(price: number, compareAt: number | null | undefined, cur: string): string {
  const was = compareAt && compareAt > price ? `<s class="c-price__was">${esc(formatMoney(compareAt, cur))}</s> ` : '';
  return `${was}<span class="c-price__now">${esc(formatMoney(price, cur))}</span>`;
}

/** The product's price: one price, or "From" the lowest of its variants' when they differ. */
const productPrice: Renderer = (b, env) => {
  const e = productEntry(b, env);
  if (!e) return note(env, 'Product price: shows the price of the product whose page or card it is in, or of the product chosen in its settings.');
  const p = productOf(e.fields);
  const range = p ? priceRange(p) : null;
  if (!p || !range) return note(env, 'This product has no price yet (its settings, under Shop).');
  const cur = currency(env);
  const same = range.min === range.max;
  // Its compare-at price shows when every variant sells at the one price.
  const compareAt = same ? sellable(p)[0]?.compareAt : null;
  const html = same ? priceHtml(range.min, compareAt, cur) : `From <span class="c-price__now">${esc(formatMoney(range.min, cur))}</span>`;
  return `<p ${root(b.attrs, ['c-price', 'c-product-price'])} data-product="${e.id}">${html}</p>`;
};

/** A variant as the script needs it: its values, price, image and what is left. */
function variantData(env: Env, e: Entry, p: Product, stock: StockMap | undefined) {
  return sellable(p).map((v) => {
    const m = v.image ? env.ctx.loader.media.get(v.image) : undefined;
    return {
      id: v.id,
      values: v.values,
      price: v.price,
      compareAt: v.compareAt,
      image: m ? mediaUrl(downsize(m, 'large').path) : null,
      // A product whose stock wasn't read (a card in a list): as many as an order takes, until the script asks.
      left: maxQuantity(p, stock?.has(e.id) ? leftOf(p, stock.get(e.id), v.id) : null),
    };
  });
}

/** Add to cart: the product's options as choices, a quantity and the button. */
const addToCart: Renderer = (b, env) => {
  const e = productEntry(b, env);
  if (!e) return note(env, 'Add to cart: on a product\'s page (or its card) it sells that product; elsewhere, choose one in its settings.');
  const p = productOf(e.fields);
  const variants = p ? variantData(env, e, p, env.ctx.data.get(STOCK_KEY) as StockMap | undefined) : [];
  if (!p || !variants.length) return note(env, 'This product has nothing for sale yet: give it a price in its settings, under Shop.');
  const a = b.attrs;
  const cur = currency(env);
  // The first variant that is left, chosen to begin with.
  const first = variants.find((v) => v.left > 0) ?? variants[0];
  const id = `c-cart-${e.id}-${String(b.id ?? '').replace(/[^\w-]/g, '')}`;
  const choices = p.options
    .map((o, i) => {
      const values = o.values.filter((val) => variants.some((v) => v.values[i] === val));
      // The first variant left is chosen by the script (data-value): the canvas, rendered by React, takes no `selected`.
      return `<label class="c-add-to-cart__option"><span>${esc(o.name)}</span><select name="option-${i}" data-value="${escAttr(first.values[i] ?? '')}">${values.map((val) => `<option value="${escAttr(val)}">${esc(val)}</option>`).join('')}</select></label>`;
    })
    .join('');
  const label = String(a.label || 'Add to cart');
  const soldOut = first.left <= 0;
  const qty = a.showQuantity === false ? '<input type="hidden" name="quantity" value="1">' : `<label class="c-add-to-cart__quantity"><span>Quantity</span><input type="number" name="quantity" value="1" min="1" max="${Math.max(1, first.left)}" inputmode="numeric"></label>`;
  return (
    `<form ${root(a, ['c-add-to-cart'])} id="${id}" data-add-to-cart data-product="${e.id}" data-title="${escAttr(e.title)}" data-currency="${escAttr(cur)}" data-variants="${jsonAttr(variants)}" data-label="${escAttr(label)}" data-cart-path="${CART_PATH}">` +
    (choices ? `<div class="c-add-to-cart__options">${choices}</div>` : '') +
    `<p class="c-price c-add-to-cart__price">${priceHtml(first.price!, first.compareAt, cur)}</p>` +
    `<div class="c-add-to-cart__row">${qty}<button type="submit" class="c-shop-button c-add-to-cart__button"${soldOut ? ' disabled' : ''}>${esc(soldOut ? 'Sold out' : label)}</button></div>` +
    `<p class="c-add-to-cart__status" role="status" aria-live="polite"></p>` +
    `<noscript><p class="c-add-to-cart__status">The cart needs JavaScript, which is off in this browser.</p></noscript>` +
    `</form>`
  );
};

/** The cart: filled in the visitor's browser from the cart it keeps and the server's prices. */
const cart: Renderer = (b, env) => {
  const a = b.attrs;
  const shop = ARCHIVE_PATHS.product ?? '/';
  const empty = String(a.empty || 'Your cart is empty.');
  // The canvas runs no scripts: a sample of what visitors see.
  const sample = env.ctx.editor
    ? `<div class="cms-editor-note">The cart: the products a visitor has added, their quantities and the subtotal. Sample lines below; checkout comes in the next part of the shop preview.</div><table class="c-cart__table"><tbody><tr><td class="c-cart__item">Sample product<br><small>Large / Blue</small></td><td>${esc(formatMoney(2000, currency(env)))}</td><td>2</td><td>${esc(formatMoney(4000, currency(env)))}</td></tr></tbody></table>`
    : '<p class="c-cart__loading">Loading your cart…</p>';
  return (
    `<div ${root(a, ['c-cart'])} data-cart data-currency="${escAttr(currency(env))}" data-empty="${escAttr(empty)}" data-shop="${escAttr(shop)}">` +
    `<div class="c-cart__body" aria-live="polite">${sample}</div>` +
    `<noscript><p>The cart needs JavaScript, which is off in this browser.</p></noscript>` +
    `</div>`
  );
};

/** A link to the cart with the number of items in it (set in the browser, so pages stay shared). */
const cartLink: Renderer = (b) => {
  const a = b.attrs;
  const label = String(a.label || 'Cart');
  return `<a ${root(a, ['c-cart-link'])} href="${CART_PATH}" data-cart-link><span class="c-cart-link__label">${esc(label)}</span> <span class="c-cart-link__count" data-cart-count hidden>0</span></a>`;
};

export const SHOP_RENDERERS: Record<string, Renderer> = {
  'product-price': productPrice,
  'add-to-cart': addToCart,
  cart,
  'cart-link': cartLink,
};
