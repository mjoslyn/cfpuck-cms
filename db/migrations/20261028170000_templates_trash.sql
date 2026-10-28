-- When a template, part or pattern was moved to the trash (null: in use). Trashed ones don't render or
-- show in pickers; the templates list's Trash restores them or deletes them for good.
ALTER TABLE templates ADD COLUMN trashed_at TIMESTAMPTZ;
