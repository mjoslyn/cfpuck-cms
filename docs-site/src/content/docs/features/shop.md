---
title: Shop (preview)
description: Products with options, variants and stock, a cart kept in the browser, and the server's quote.
sidebar:
  order: 12
---

The shop is optional and is being built in phases. Phase 1, here now: products, options and variants,
stock, the shop's blocks and the cart. Checkout (payments, shipping, tax, discounts, orders) is next.

Turn it on under **Settings > Shop** (admins). It brings the `product` type under Content, product pages,
the shop at `/shop/`, product categories, the cart at `/cart/` and the shop blocks.

## Products

The core supplies the `product` type and the `product_category` taxonomy (`src/lib/shop/types.ts`). A
site changes them with `shop` in `src/site/config.ts` (`product` takes any type option plus `fields`;
`category` the taxonomy's options), or lists its own `product` type, which it keeps whole and which stays
shown while the shop is off.

What a product sells is in its fields under the reserved key `shop` (`src/lib/shop/config.ts`):

| Setting | |
| --- | --- |
| `price`, `compareAt` | In cents. No price: not for sale. |
| `sku`, `weight` | Weight in the unit chosen under Settings > Shop. |
| `ships`, `pickupOnly`, `taxable` | For checkout. |
| `maxPerOrder` | Empty: 99. |
| `trackStock` | Off: no limit. |
| `options` | Up to 3, each with a name and values. |
| `variants` | One per combination: a stable `id`, its `values`, and its own price, compare-at price, SKU, weight and image (media id), or `off`. |

A product with no options has one variant, `default`. Changing the options keeps each variant whose
values stay (its id, price and stock), adds the new combinations and drops the rest.

## Stock

Counts are in the `shop_stock` table (product, variant, on hand), apart from the product's fields, so
saving a product never overwrites a count. The product's settings save each count as it changes.

## The cart

The cart is kept in the visitor's browser (`localStorage`, `public/assets/js/cart.js`), so pages with shop
blocks stay cached and shared. The script:

- adds to the cart from **Add to cart**, offering what's left of each combination
- asks `GET /api/shop/availability?ids=` what's left, since a cached page can be a minute old
- fills the **Cart** block from `POST /api/shop/quote`, the server's prices (`quoteCart`,
  `src/lib/shop/cart.ts`): lines no longer sold are dropped, quantities are cut to what's left

Both endpoints read as the visitor sees the site (members-only products only for their members) and
answer 404 while the shop is off.

## Blocks

`product-price`, `add-to-cart`, `cart` and `cart-link` (`src/render/c/shop.ts`), offered in the editor's
**Shop** category while the shop is on and rendering nothing while it is off. The product card design
(`product`) is added to the site's cards unless the site has its own.

## Templates

Turning the shop on the first time makes `single-product` and `archive-product` if they aren't there
(`src/lib/shop/templates.ts`); `npm run seed` does the same while the shop is on. The cart is a built-in
page at `/cart/` unless a page has that address.
