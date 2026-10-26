-- A sign-up for an address already on file: what it says (consent, tags, fields) waits here until the
-- address is confirmed, so a stranger's form can't change an existing contact (src/lib/mailing/contacts.ts).
-- And when the last confirmation email went to it, for the sign-up form's site-wide limit a minute.
ALTER TABLE contacts ADD COLUMN pending_signup JSON_TEXT;
ALTER TABLE contacts ADD COLUMN confirm_sent_at TIMESTAMPTZ;
CREATE INDEX contacts_confirm_sent_at ON contacts (confirm_sent_at);
