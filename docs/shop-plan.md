# Shop plan

The shop is built in phases on the preview branch (`claude/dazzling-euler-p0tfxa`) and isn't merged to
`main` or the sites until the owner says so. Phase 1 is done (commit `288083f`; CORE.md, Shop). This
file is the plan for the rest, with the decisions already made.

## Decisions

- Shipping: manual rates and pickup now; a carrier API may come later, so rates come through one
  interface a carrier can plug into.
- Variants are in the first release (done in phase 1).
- Discounts are in the first usable release (phase 2).
- Restocking on a refund or cancel is the admin's choice each time; nothing restocks on its own.
- Orders and stock are synced and backed up, with the rules below.
- Snowbelt keeps the shop off (card processors don't take cannabis); it has its own `product` type,
  which the shop leaves alone.

## Phase 1 (done)

Feature switch (Settings > Shop: on, currency, weight unit), the core's `product` type and
`product_category` taxonomy, the product's Shop settings (price, compare-at price, SKU, weight, shipped,
pickup only, taxed, most per order, count stock, up to 3 options, a variant per combination with its own
price, SKU, weight and image, or not sold), stock per variant in `shop_stock` (saved as it changes),
the Product price, Add to cart, Cart and Cart link blocks, the product card, the cart in the browser
with the server's quote (`/api/shop/quote`) and availability (`/api/shop/availability`), the built-in
`/cart/` page, and the `single-product` and `archive-product` templates made when the shop is turned on.

## Phase 2: checkout (the first usable release)

### Settings > Shop

- Payment provider (Stripe or Square, offered as Settings > Tickets does, keys from Connections), how
  long an unpaid order holds its stock (30-120 minutes), the store's address for pickup.
- Shipping zones: a set of countries or US states, each with rates (name, price, and optionally a rule:
  by order subtotal bands, by weight bands, free over an amount). The buyer picks from the rates that
  fit their address and cart.
- Pickup locations: name, address, hours note and a fee (often none). No shipping address asked.
- Tax: one rate, optionally per state, on taxable lines, and on shipping if chosen.
- Order emails (confirmation, shipped, refunded, the admin's copy).

### Shipping rates

- `ShippingSource.quote(cart, address) => Rate[]`; the manual rates are the first source. A carrier
  (Shippo, EasyPost, USPS) can be a second later, its key under Connections, without changing checkout.
- A cart with a pickup-only item offers only pickup; a cart with nothing shipped asks no address.
- Each order keeps the chosen rate's name, price and source.

### Discounts

- Table `shop_discounts`: a code (case-insensitive) or automatic; percent, fixed amount or free shipping;
  the whole order or chosen products or categories; minimum subtotal; start and end; total use limit;
  one per email; members only (by level). One per order in this release.
- Uses counted in the statement that holds the stock (unpaid holds count until they expire), so the last
  use can't be taken twice.
- The discount is spread across the lines (rounding on the last), so tax and part refunds stay right
  and providers that refuse negative lines (Stripe) take it.
- Shop > Discounts screen with uses and sales; merge tags `{discount_code}`, `{discount_total}`.

### Orders and checkout

- Tables `shop_orders` (UUID id, token, status pending/paid/expired/cancelled/refunded, buyer, address,
  shipping rate, subtotal, discount, shipping, tax, total, refunded, currency, provider ref, order and
  payment id, IP, member, fulfilment and tracking, notes, hold until) and `shop_order_lines` (a copy of
  each line: product, variant, name, options, SKU, unit price, quantity, restocked).
- `POST /api/shop/checkout`: the cart re-quoted, the address, rate, tax and discount worked out on the
  server; `shop_order_create` inserts the order and its lines and holds stock in one statement (on hand
  against paid orders and unexpired holds, as `ticket_order_create`), with the same per-buyer limits by
  IP and email. Then the provider's hosted checkout (`pickProvider`, `create` with the items plus
  shipping and tax lines).
- `/api/shop/return` checks with the provider; `shopWebhook` beside `formsWebhook` and `ticketsWebhook`
  in `/api/payments/[provider].ts`; `markPaid` is idempotent, takes the stock off and sends the
  confirmation once. Expired holds are released by the hourly run. A total under `MIN_CHARGE` is refused.
- The Cart block gets Checkout: details, address or pickup, rate, discount code, totals, then Pay.
  The order page (`/cart/?order=<token>`) is personal: never cached, noindex.
- Member prices (by level, as tickets have) and members-only products.

### Admin

- A Shop menu while it is on: Orders, Discounts (Stock in phase 3). Products stay under Content.
- Orders (`/admin/shop/`): filter by status and fulfilment; an order's detail with mark shipped or
  picked up (sends the shipped email with tracking), resend, cancel, refund (admins), notes; CSV export.
- Refund and cancel dialogs list the lines, each with an amount and a "Return to stock" quantity
  starting at 0; restocked quantities are recorded per line so nothing restocks twice. A refund made in
  Stripe or Square (reported by the webhook) never restocks on its own: the order gets a note and a
  Restock button. Refunds reuse `refund_attempt` idempotency and the provider's refunded total.
- Order writes don't clear the page cache (availability is fetched live).

### Emails

The email builder with a `shop` kit (merge tags, an Order details block, the Payment block) and default
templates per kind (`shop:<kind>`): confirmation, shipped, refunded, the admin's copy. An optional
"Email me news" tick at checkout signs up through Mailing (double opt-in).

### Sync and backups

- New groups: Orders (`shop_orders`, `shop_order_lines`) and Stock (`shop_stock`); snapshots and sync
  backups hold them too. Stock rows match by product and variant.
- An order's status never goes backwards in a sync: one further along, or changed more recently, on the
  target is a conflict and left alone.
- Stock is unticked by default; ticking it warns and Show differences shows the target's counts.
- Syncing an order sends nothing and changes no stock.
- A restore never deletes orders made since the backup (money taken); restored stock is the backup's
  count minus what orders paid since then took; status never goes backwards.
- Backups now hold buyers' details: they stay in the private `sync-backups/` folder, Download stays
  admins only, and the guide says so.

### Tests and docs

Unit tests for totals (discount spread, tax, shipping), the race for the last item and the last
discount use, webhook idempotency, refund and restock, and the sync and restore rules; a
`scripts/shop-e2e.ts` against the Stripe and Square sandboxes. CORE.md (Shop), the developer page and
the guide's "Selling things" with new screenshots.

## Phase 3

- Stock screen: every product and variant with on-hand counts to edit, and a low-stock mark.
- Low-stock alerts by email.
- Digital downloads: a signed, limited link to a media file after payment.
- A carrier API as a second shipping source.

## Left out

Subscriptions, more than one currency, buyer accounts beyond Members, abandoned-cart emails, a till
system, marketplace sellers.
