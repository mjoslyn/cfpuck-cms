-- A contact's address as mail_suppressions keeps it (SHA-256, hex), so a campaign's audience leaves out
-- suppressed addresses in SQL (SQLite has no digest function). Filled by the query layer whenever a
-- contact's email is written (src/lib/db/sqlite.ts).
ALTER TABLE contacts ADD COLUMN email_hash TEXT NOT NULL DEFAULT '';
CREATE INDEX contacts_email_hash ON contacts (email_hash);
