-- The site's database on D1 (SQLite), made from the Postgres schema (scripts/pg-to-d1-schema.ts).
-- Times are ISO 8601 text in UTC (as JavaScript writes them), JSON columns are JSON text, arrays
-- are JSON arrays and booleans 0 or 1; the query layer (src/lib/db) reads them back as before.

CREATE TABLE accounts (
  id TEXT NOT NULL,
  user_id UUID NOT NULL,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  password TEXT,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at TIMESTAMPTZ,
  refresh_token_expires_at TIMESTAMPTZ,
  scope TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (id),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE campaign_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  n INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  mailgun_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  attempted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (campaign_id, n),
  FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE,
  CHECK ((status IN ('pending', 'attempting', 'accepted', 'failed', 'unknown', 'skipped')))
);

CREATE TABLE campaign_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'content',
  FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE,
  CHECK ((kind IN ('content', 'honeypot')))
);

CREATE TABLE campaign_sends (
  campaign_id INTEGER NOT NULL,
  contact_id INTEGER NOT NULL,
  batch_id INTEGER,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  delivered_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  machine_clicked_at TIMESTAMPTZ,
  human_confirmed_at TIMESTAMPTZ,
  bounced_at TIMESTAMPTZ,
  complained_at TIMESTAMPTZ,
  unsubscribed_at TIMESTAMPTZ,
  PRIMARY KEY (campaign_id, contact_id),
  FOREIGN KEY (batch_id) REFERENCES campaign_batches (id) ON DELETE SET NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns (id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  CHECK ((status IN ('queued', 'dropped', 'sent', 'delivered', 'failed', 'bounced', 'complained')))
);

CREATE TABLE campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  from_name TEXT NOT NULL DEFAULT '',
  reply_to TEXT NOT NULL DEFAULT '',
  design JSON_TEXT,
  text TEXT NOT NULL DEFAULT '',
  list_ids ARRAY_TEXT NOT NULL DEFAULT '[]',
  audience JSON_TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  digest_id INTEGER,
  issue_key TEXT,
  since TIMESTAMPTZ,
  track_links BOOLEAN NOT NULL DEFAULT 1,
  utm BOOLEAN NOT NULL DEFAULT 0,
  html TEXT,
  text_rendered TEXT,
  vars JSON_TEXT,
  recipients INTEGER NOT NULL DEFAULT 0,
  claim_token TEXT,
  claimed_at TIMESTAMPTZ,
  error TEXT NOT NULL DEFAULT '',
  created_by UUID,
  sent_by UUID,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  segment_id INTEGER,
  FOREIGN KEY (approved_by) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (digest_id) REFERENCES digests (id) ON DELETE SET NULL,
  FOREIGN KEY (segment_id) REFERENCES mail_segments (id) ON DELETE RESTRICT,
  FOREIGN KEY (sent_by) REFERENCES users (id) ON DELETE SET NULL,
  CHECK ((status IN ('draft', 'review', 'scheduled', 'sending', 'sent', 'paused', 'cancelled', 'failed', 'skipped')))
);
CREATE TRIGGER campaigns_touch AFTER UPDATE ON campaigns FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE campaigns SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE rowid = NEW.rowid;
END;

CREATE TABLE compose_jobs (
  id UUID NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  session_id UUID NOT NULL,
  author_id UUID,
  status TEXT NOT NULL DEFAULT 'queued',
  input JSON_TEXT NOT NULL DEFAULT '{}',
  progress TEXT,
  say TEXT NOT NULL DEFAULT '',
  notes JSON_TEXT NOT NULL DEFAULT '[]',
  result JSON_TEXT,
  error TEXT,
  token TEXT NOT NULL DEFAULT (lower(hex(randomblob(32)))),
  created_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (id),
  FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (session_id) REFERENCES compose_sessions (id) ON DELETE CASCADE
);
CREATE TRIGGER compose_jobs_touch AFTER UPDATE ON compose_jobs FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE compose_jobs SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE rowid = NEW.rowid;
END;

CREATE TABLE compose_sessions (
  id UUID NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))),
  entry_id INTEGER,
  author_id UUID,
  entry_type TEXT NOT NULL DEFAULT 'page',
  turns JSON_TEXT NOT NULL DEFAULT '[]',
  materials JSON_TEXT NOT NULL DEFAULT '{"docs":[],"links":[],"images":[],"videos":[]}',
  plan JSON_TEXT,
  block_prefix TEXT NOT NULL DEFAULT ('cs' || lower(hex(randomblob(4)))),
  created_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (id),
  FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (entry_id) REFERENCES entries (id) ON DELETE CASCADE
);
CREATE TRIGGER compose_sessions_touch AFTER UPDATE ON compose_sessions FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE compose_sessions SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE rowid = NEW.rowid;
END;

CREATE TABLE contact_lists (
  contact_id INTEGER NOT NULL,
  list_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  subscribed_at TIMESTAMPTZ,
  unsubscribed_at TIMESTAMPTZ,
  PRIMARY KEY (contact_id, list_id),
  FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
  FOREIGN KEY (list_id) REFERENCES mail_lists (id) ON DELETE CASCADE,
  CHECK ((status IN ('pending', 'subscribed', 'unsubscribed')))
);

CREATE TABLE contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  attributes JSON_TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  consent_source TEXT NOT NULL DEFAULT '',
  consent_text TEXT NOT NULL DEFAULT '',
  consent_at TIMESTAMPTZ,
  consent_ip TEXT NOT NULL DEFAULT '',
  confirmed_at TIMESTAMPTZ,
  unsubscribed_at TIMESTAMPTZ,
  confirm_day DATE,
  confirm_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  tags ARRAY_TEXT NOT NULL DEFAULT '[]',
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  name TEXT GENERATED ALWAYS AS (trim(((first_name || ' ') || last_name))) VIRTUAL,
  UNIQUE (email),
  CHECK ((email = lower(email))),
  CHECK ((status IN ('pending', 'subscribed', 'unsubscribed', 'bounced', 'complained')))
);
CREATE TRIGGER contacts_touch AFTER UPDATE ON contacts FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE contacts SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE rowid = NEW.rowid;
END;

CREATE TABLE digests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT 'Weekly digest',
  list_ids ARRAY_TEXT NOT NULL DEFAULT '[]',
  audience JSON_TEXT NOT NULL DEFAULT '{}',
  weekday INTEGER NOT NULL DEFAULT 4,
  send_time TEXT NOT NULL DEFAULT '09:00',
  subject TEXT NOT NULL DEFAULT '',
  from_name TEXT NOT NULL DEFAULT '',
  reply_to TEXT NOT NULL DEFAULT '',
  design JSON_TEXT,
  text TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'review',
  review_hours INTEGER NOT NULL DEFAULT 24,
  skip_when_empty BOOLEAN NOT NULL DEFAULT 1,
  min_items INTEGER NOT NULL DEFAULT 1,
  track_links BOOLEAN NOT NULL DEFAULT 1,
  utm BOOLEAN NOT NULL DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT 0,
  last_run_key TEXT,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  segment_id INTEGER,
  FOREIGN KEY (segment_id) REFERENCES mail_segments (id) ON DELETE RESTRICT,
  CHECK ((min_items >= 0)),
  CHECK ((mode IN ('auto', 'review'))),
  CHECK (((review_hours >= 1) AND (review_hours <= 168))),
  CHECK ((send_time GLOB '[0-9][0-9]:[0-9][0-9]')),
  CHECK (((weekday >= 0) AND (weekday <= 6)))
);
CREATE TRIGGER digests_touch AFTER UPDATE ON digests FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE digests SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE rowid = NEW.rowid;
END;

CREATE TABLE email_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kit TEXT NOT NULL,
  name TEXT NOT NULL,
  design JSON_TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  default_for TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (default_for),
  CHECK ((kit IN ('mailing', 'form', 'ticket')))
);
CREATE TRIGGER email_templates_touch AFTER UPDATE ON email_templates FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE email_templates SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE rowid = NEW.rowid;
END;

CREATE TABLE entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  excerpt TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  template TEXT,
  parent_id INTEGER,
  menu_order INTEGER NOT NULL DEFAULT 0,
  featured_media_id INTEGER,
  fields JSON_TEXT NOT NULL DEFAULT '{}',
  content JSON_TEXT,
  event_start TIMESTAMPTZ,
  event_end TIMESTAMPTZ,
  event_all_day BOOLEAN,
  published_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  title_rendered TEXT,
  excerpt_rendered TEXT,
  draft_saved_at TIMESTAMPTZ,
  body_text TEXT NOT NULL DEFAULT '',
  UNIQUE (type, slug),
  FOREIGN KEY (featured_media_id) REFERENCES media (id) ON DELETE SET NULL,
  FOREIGN KEY (parent_id) REFERENCES entries (id) ON DELETE SET NULL,
  CHECK ((status IN ('publish', 'draft', 'private', 'trash')))
);
CREATE TRIGGER entries_touch AFTER UPDATE ON entries FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE entries SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE rowid = NEW.rowid;
END;

CREATE TABLE entry_drafts (
  entry_id INTEGER NOT NULL,
  draft JSON_TEXT NOT NULL,
  PRIMARY KEY (entry_id),
  FOREIGN KEY (entry_id) REFERENCES entries (id) ON DELETE CASCADE
);

CREATE TABLE entry_terms (
  entry_id INTEGER NOT NULL,
  term_id INTEGER NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (entry_id, term_id),
  FOREIGN KEY (entry_id) REFERENCES entries (id) ON DELETE CASCADE,
  FOREIGN KEY (term_id) REFERENCES terms (id) ON DELETE CASCADE
);

CREATE TABLE form_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form TEXT NOT NULL,
  data JSON_TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  form_id INTEGER,
  payment JSON_TEXT,
  FOREIGN KEY (form_id) REFERENCES forms (id) ON DELETE SET NULL
);

CREATE TABLE forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  definition JSON_TEXT NOT NULL DEFAULT '{}',
  notifications JSON_TEXT NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TRIGGER forms_touch AFTER UPDATE ON forms FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE forms SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE rowid = NEW.rowid;
END;

CREATE TABLE link_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL,
  campaign_id INTEGER NOT NULL,
  contact_id INTEGER,
  at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  method TEXT NOT NULL DEFAULT 'GET',
  user_agent TEXT NOT NULL DEFAULT '',
  ip_prefix TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  scanner_ip BOOLEAN NOT NULL DEFAULT 0,
  verdict TEXT NOT NULL DEFAULT 'likely_human',
  reasons ARRAY_TEXT NOT NULL DEFAULT '[]',
  confirmed_at TIMESTAMPTZ,
  FOREIGN KEY (link_id) REFERENCES campaign_links (id) ON DELETE CASCADE,
  CHECK ((verdict IN ('machine', 'likely_human', 'human')))
);

CREATE TABLE mail_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  event TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT '',
  recipient TEXT NOT NULL DEFAULT '',
  campaign_id INTEGER,
  verdict TEXT NOT NULL DEFAULT '',
  payload JSON_TEXT NOT NULL DEFAULT '{}',
  received_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (event_id)
);

CREATE TABLE mail_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  public BOOLEAN NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE mail_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  rules JSON_TEXT NOT NULL DEFAULT '{"match":"all","rules":[]}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TRIGGER mail_segments_touch AFTER UPDATE ON mail_segments FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE mail_segments SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE rowid = NEW.rowid;
END;

CREATE TABLE mail_suppressions (
  email_hash TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (email_hash)
);

CREATE TABLE mailgun_tokens (
  token TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (token)
);

CREATE TABLE media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  alt TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  sizes JSON_TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  focal_point JSON_TEXT,
  formats JSON_TEXT NOT NULL DEFAULT '{}',
  processed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  crop_focals JSON_TEXT NOT NULL DEFAULT '{}',
  crop_images JSON_TEXT NOT NULL DEFAULT '{}',
  UNIQUE (path)
);
CREATE TRIGGER media_touch AFTER UPDATE ON media FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE media SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE rowid = NEW.rowid;
END;

CREATE TABLE members (
  user_id UUID NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  expires_on DATE,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CHECK ((status IN ('pending', 'active', 'suspended')))
);
CREATE TRIGGER members_touch AFTER UPDATE ON members FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE members SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE rowid = NEW.rowid;
END;

CREATE TABLE not_found (
  path TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  referrer TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (path),
  CHECK ((length(path) <= 500))
);

CREATE TABLE profiles (
  id UUID NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (id),
  FOREIGN KEY (id) REFERENCES users (id) ON DELETE CASCADE,
  CHECK ((role IN ('viewer', 'editor', 'admin')))
);

CREATE TABLE redirects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_path TEXT NOT NULL,
  to_url TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 301,
  note TEXT NOT NULL DEFAULT '',
  hits INTEGER NOT NULL DEFAULT 0,
  last_hit_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  wildcard BOOLEAN GENERATED ALWAYS AS ((substr(from_path, -1) = '*')) VIRTUAL,
  UNIQUE (from_path),
  CHECK ((from_path LIKE '/%')),
  CHECK ((status IN (301, 302))),
  CHECK ((to_url <> ''))
);
CREATE TRIGGER redirects_touch AFTER UPDATE ON redirects FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE redirects SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE rowid = NEW.rowid;
END;

CREATE TABLE revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  content JSON_TEXT,
  fields JSON_TEXT,
  author_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  action TEXT,
  entry JSON_TEXT,
  restored_from INTEGER,
  restored_edited BOOLEAN,
  FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY (entry_id) REFERENCES entries (id) ON DELETE CASCADE,
  FOREIGN KEY (restored_from) REFERENCES revisions (id) ON DELETE SET NULL
);

CREATE TABLE sessions (
  id TEXT NOT NULL,
  user_id UUID NOT NULL,
  token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (id),
  UNIQUE (token),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE settings (
  key TEXT NOT NULL,
  value JSON_TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (key)
);
CREATE TRIGGER settings_touch AFTER UPDATE ON settings FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE settings SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE rowid = NEW.rowid;
END;

CREATE TABLE templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content JSON_TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (kind, slug),
  CHECK ((kind IN ('template', 'part', 'pattern', 'navigation')))
);
CREATE TRIGGER templates_touch AFTER UPDATE ON templates FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE templates SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE rowid = NEW.rowid;
END;

CREATE TABLE terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  taxonomy TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  parent_id INTEGER,
  fields JSON_TEXT NOT NULL DEFAULT '{}',
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (taxonomy, slug),
  FOREIGN KEY (parent_id) REFERENCES terms (id) ON DELETE SET NULL
);

CREATE TABLE ticket_emails (
  entry_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT,
  design JSON_TEXT,
  text TEXT,
  off BOOLEAN NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (entry_id, kind),
  FOREIGN KEY (entry_id) REFERENCES entries (id) ON DELETE CASCADE,
  CHECK ((kind IN ('confirmation', 'reminder', 'followUp', 'waitlist', 'admin')))
);
CREATE TRIGGER ticket_emails_touch AFTER UPDATE ON ticket_emails FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE ticket_emails SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE rowid = NEW.rowid;
END;

CREATE TABLE ticket_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL,
  code TEXT NOT NULL,
  entry_id INTEGER,
  occurrence TEXT NOT NULL DEFAULT '',
  event_title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  provider TEXT NOT NULL,
  provider_ref TEXT,
  provider_order TEXT,
  provider_payment TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  address JSON_TEXT,
  answers JSON_TEXT NOT NULL DEFAULT '{}',
  items JSON_TEXT NOT NULL DEFAULT '[]',
  quantity INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  refunded_amount INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  checked_in_at TIMESTAMPTZ,
  emailed_at TIMESTAMPTZ,
  reminded_at TIMESTAMPTZ,
  followed_up_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  page TEXT NOT NULL DEFAULT '',
  member_id UUID,
  UNIQUE (code),
  UNIQUE (token),
  FOREIGN KEY (entry_id) REFERENCES entries (id) ON DELETE SET NULL,
  FOREIGN KEY (member_id) REFERENCES users (id) ON DELETE SET NULL,
  CHECK ((amount >= 0)),
  CHECK ((provider IN ('free', 'stripe', 'square'))),
  CHECK ((quantity > 0)),
  CHECK ((status IN ('pending', 'paid', 'cancelled', 'expired', 'refunded')))
);
CREATE TRIGGER ticket_orders_touch AFTER UPDATE ON ticket_orders FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE ticket_orders SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE rowid = NEW.rowid;
END;

CREATE TABLE ticket_waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER,
  occurrence TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'waiting',
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  page TEXT NOT NULL DEFAULT '',
  UNIQUE (entry_id, occurrence, email),
  FOREIGN KEY (entry_id) REFERENCES entries (id) ON DELETE CASCADE,
  CHECK ((quantity > 0)),
  CHECK ((status IN ('waiting', 'notified', 'bought', 'removed')))
);
CREATE TRIGGER ticket_waitlist_touch AFTER UPDATE ON ticket_waitlist FOR EACH ROW WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE ticket_waitlist SET updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE rowid = NEW.rowid;
END;

CREATE TABLE users (
  id UUID NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  email_verified BOOLEAN NOT NULL DEFAULT 0,
  image TEXT,
  invite TEXT,
  invited_at TIMESTAMPTZ,
  last_sign_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (id),
  UNIQUE (email)
);

CREATE TABLE verifications (
  id TEXT NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (id)
);

CREATE INDEX accounts_user_id_idx ON accounts (user_id);
CREATE INDEX campaign_links_campaign ON campaign_links (campaign_id);
CREATE INDEX campaign_sends_batch ON campaign_sends (batch_id);
CREATE INDEX campaign_sends_contact ON campaign_sends (contact_id);
CREATE INDEX campaigns_due ON campaigns (status, scheduled_at);
CREATE UNIQUE INDEX campaigns_issue ON campaigns (digest_id, issue_key) WHERE (digest_id IS NOT NULL);
CREATE UNIQUE INDEX compose_jobs_one_active ON compose_jobs (session_id) WHERE (status IN ('queued', 'running'));
CREATE INDEX compose_jobs_session_idx ON compose_jobs (session_id, created_at DESC);
CREATE INDEX compose_sessions_entry_idx ON compose_sessions (entry_id, updated_at DESC);
CREATE INDEX contact_lists_list ON contact_lists (list_id, status);
CREATE INDEX contacts_status ON contacts (status);
CREATE INDEX entries_event_start_idx ON entries (event_start) WHERE (type = 'event');
CREATE INDEX entries_featured_media_idx ON entries (featured_media_id);
CREATE INDEX entries_parent_idx ON entries (parent_id);
CREATE INDEX entries_type_status_idx ON entries (type, status, published_at DESC);
CREATE INDEX entry_terms_term_idx ON entry_terms (term_id);
CREATE INDEX form_submissions_form_id ON form_submissions (form_id, created_at DESC);
CREATE INDEX form_submissions_payment_order ON form_submissions (json_extract(payment, '$.order')) WHERE json_extract(payment, '$.order') IS NOT NULL;
CREATE INDEX form_submissions_payment_ref ON form_submissions (json_extract(payment, '$.ref')) WHERE (payment IS NOT NULL);
CREATE INDEX link_clicks_at ON link_clicks (at);
CREATE INDEX link_clicks_send ON link_clicks (campaign_id, contact_id, at);
CREATE INDEX mail_events_campaign ON mail_events (campaign_id, event);
CREATE INDEX mail_events_received ON mail_events (received_at);
CREATE INDEX members_status ON members (status, level);
CREATE INDEX redirects_wildcard_idx ON redirects (wildcard) WHERE wildcard;
CREATE INDEX revisions_author_idx ON revisions (author_id);
CREATE INDEX revisions_entry_idx ON revisions (entry_id, created_at DESC);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX terms_parent_idx ON terms (parent_id);
CREATE INDEX ticket_orders_entry ON ticket_orders (entry_id, occurrence, status);
CREATE INDEX ticket_orders_paid ON ticket_orders (entry_id) WHERE ((status = 'paid') AND ((reminded_at IS NULL) OR (followed_up_at IS NULL)));
CREATE INDEX ticket_orders_pending ON ticket_orders (expires_at) WHERE (status = 'pending');
CREATE INDEX ticket_orders_provider_order ON ticket_orders (provider_order);
CREATE INDEX ticket_orders_provider_payment ON ticket_orders (provider_payment);
CREATE INDEX ticket_orders_provider_ref ON ticket_orders (provider_ref);
CREATE INDEX ticket_waitlist_entry ON ticket_waitlist (entry_id, occurrence, status, id);
CREATE INDEX verifications_identifier_idx ON verifications (identifier);
