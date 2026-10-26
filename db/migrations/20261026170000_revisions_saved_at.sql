-- Autosaves keep one revision per stretch of editing, written over as it goes on: created_at is when the
-- stretch began, saved_at its latest write. Checkpoints (manual saves) have both at once.
ALTER TABLE revisions ADD COLUMN saved_at TIMESTAMPTZ;
