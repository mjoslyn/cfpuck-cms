-- Campaigns: visits that arrived with utm_ parameters (kind `campaign`, target `campaign|source|medium`).
-- SQLite can't change a CHECK, so the table is made again with the new kind.
CREATE TABLE site_stats_new (
  day DATE NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '',
  target TEXT NOT NULL DEFAULT '',
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, path, target),
  CHECK ((kind IN ('view', 'visitor', 'click', 'referrer', 'campaign'))),
  CHECK ((length(path) <= 300 AND length(target) <= 500))
);
INSERT INTO site_stats_new (day, kind, path, target, hits) SELECT day, kind, path, target, hits FROM site_stats;
DROP TABLE site_stats;
ALTER TABLE site_stats_new RENAME TO site_stats;
