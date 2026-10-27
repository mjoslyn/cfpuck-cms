-- A Compose conversation about a template, part or pattern (edited on its own, with no entry):
-- "<kind>:<slug>", so the editor finds it again.
ALTER TABLE compose_sessions ADD COLUMN template TEXT;
CREATE INDEX compose_sessions_template_idx ON compose_sessions (template);
