-- A template's, part's or pattern's former addresses (slugs), kept when it is renamed, so anything still
-- naming an old one (a revision, a site's code, a copy that hasn't synced) finds it.
ALTER TABLE templates ADD COLUMN former_slugs ARRAY_TEXT NOT NULL DEFAULT '[]';
