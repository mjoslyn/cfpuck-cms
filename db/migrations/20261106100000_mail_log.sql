-- The email log (Settings > Email log, src/lib/mail-log.ts): each email the site sends itself (forms,
-- tickets, accounts, confirmations; not Mailgun's campaign batches), with who it went to, its subject,
-- how it went and, unless it carries a sign-in or confirmation link (`withheld`), its body. Kept while
-- the log is on, for its days, then pruned hourly. Admins read it; only the server writes.
CREATE TABLE mail_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  kind TEXT NOT NULL DEFAULT 'other',
  to_addresses TEXT NOT NULL DEFAULT '',
  from_address TEXT NOT NULL DEFAULT '',
  reply_to TEXT,
  subject TEXT NOT NULL DEFAULT '',
  html TEXT,
  text TEXT,
  withheld BOOLEAN NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'sent',
  via TEXT NOT NULL DEFAULT '',
  error TEXT,
  CHECK ((status IN ('sent', 'failed', 'not-sent')))
);
CREATE INDEX mail_log_created ON mail_log (created_at);
