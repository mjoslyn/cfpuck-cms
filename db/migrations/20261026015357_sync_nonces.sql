-- Sync: the nonces of signed requests from the other copy (src/lib/sync-remote.ts), each taken once
-- while its signature is good (five minutes from its signed time, `at`, in milliseconds), so a captured
-- request can't be sent again. The server's only; older ones are pruned as requests come in.
CREATE TABLE sync_nonces (
  nonce TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (nonce)
);
CREATE INDEX sync_nonces_at ON sync_nonces (at);
