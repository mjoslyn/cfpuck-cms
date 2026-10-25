-- Full-text search over entries (src/lib/data.ts, the query layer's textSearch): an FTS5 index of their
-- title, excerpt and readable text (body_text, which the query layer fills from content), kept in step by
-- triggers. Words are matched without regard to case or accents (unicode61, remove_diacritics 2).
CREATE VIRTUAL TABLE entries_fts USING fts5(title, excerpt, body_text, content='entries', content_rowid='id', tokenize='unicode61 remove_diacritics 2');

CREATE TRIGGER entries_fts_insert AFTER INSERT ON entries FOR EACH ROW BEGIN
  INSERT INTO entries_fts (rowid, title, excerpt, body_text) VALUES (NEW.id, NEW.title, NEW.excerpt, NEW.body_text);
END;

CREATE TRIGGER entries_fts_delete AFTER DELETE ON entries FOR EACH ROW BEGIN
  INSERT INTO entries_fts (entries_fts, rowid, title, excerpt, body_text) VALUES ('delete', OLD.id, OLD.title, OLD.excerpt, OLD.body_text);
END;

CREATE TRIGGER entries_fts_update AFTER UPDATE OF title, excerpt, body_text ON entries FOR EACH ROW BEGIN
  INSERT INTO entries_fts (entries_fts, rowid, title, excerpt, body_text) VALUES ('delete', OLD.id, OLD.title, OLD.excerpt, OLD.body_text);
  INSERT INTO entries_fts (rowid, title, excerpt, body_text) VALUES (NEW.id, NEW.title, NEW.excerpt, NEW.body_text);
END;

-- The entries already there.
INSERT INTO entries_fts (entries_fts) VALUES ('rebuild');
