-- A page edited in layout mode is its template's document: each of its saves keeps the template's
-- content ({ kind, slug, content }) beside the page's, so that version can be restored.
ALTER TABLE revisions ADD COLUMN template JSON_TEXT;
