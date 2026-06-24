CREATE TABLE IF NOT EXISTS short_links (
  id SERIAL PRIMARY KEY,
  hash VARCHAR(12) UNIQUE NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS short_links_hash_idx ON short_links (hash);
