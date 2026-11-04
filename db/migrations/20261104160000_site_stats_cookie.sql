-- Stats' visitor cookie (Settings > Stats, src/lib/stats.ts): a visitor counted by their cookie is kept
-- (cookie = 1) as long as the counts are, so unique and returning visitors can be counted over a range;
-- those counted without one are still emptied after the day.
ALTER TABLE site_stat_visitors ADD COLUMN cookie BOOLEAN NOT NULL DEFAULT 0;
CREATE INDEX site_stat_visitors_hash ON site_stat_visitors (hash, day);
