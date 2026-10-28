-- Keys set under Settings > Connections (Anthropic, Stripe, Square, Mailgun), encrypted with a key made
-- from AUTH_SECRET (src/lib/site-keys.ts). The server's only: no role reads it, and sync, backups and
-- restores leave it alone. A key set in the environment wins over one here.
CREATE TABLE site_keys (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  hint TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TRIGGER site_keys_touch AFTER UPDATE ON site_keys FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE site_keys SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE rowid = NEW.rowid;
END;
