-- The shop's stock (Settings > Shop, src/lib/shop/config.ts): how many of each product variant are on
-- hand, kept apart from the product's fields so saving a product never overwrites a count. A product
-- with no options has one variant, 'default'. No row, or a product that doesn't count stock: no limit.
CREATE TABLE shop_stock (
  product_id INTEGER NOT NULL,
  variant TEXT NOT NULL,
  on_hand INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (product_id, variant),
  FOREIGN KEY (product_id) REFERENCES entries (id) ON DELETE CASCADE
);
CREATE TRIGGER shop_stock_touch AFTER UPDATE ON shop_stock FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE shop_stock SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE rowid = NEW.rowid;
END;
