-- Site statistics (src/lib/stats.ts): counts per day in the site's time zone, no cookies and no
-- addresses kept. kind: view (a page's views), visitor (people that day, path ''), click (a link
-- clicked: the page it was on, the address it led to), referrer (visits from another site: its host).
CREATE TABLE site_stats (
  day DATE NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL DEFAULT '',
  target TEXT NOT NULL DEFAULT '',
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, path, target),
  CHECK ((kind IN ('view', 'visitor', 'click', 'referrer'))),
  CHECK ((length(path) <= 300 AND length(target) <= 500))
);

-- Who has been counted today: a hash of the day, a secret, the visitor's address and browser, so a
-- visitor is counted once a day and can't be followed from one day to the next. Rows go after a day.
CREATE TABLE site_stat_visitors (
  day DATE NOT NULL,
  hash TEXT NOT NULL,
  PRIMARY KEY (day, hash)
);
