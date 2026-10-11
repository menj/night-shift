-- Night Shift: PostgreSQL schema.
CREATE TABLE IF NOT EXISTS completions (
  id          SERIAL PRIMARY KEY,
  player_name VARCHAR(40)  NOT NULL,
  score       INTEGER      NOT NULL,
  moves       INTEGER      NOT NULL,
  hints       INTEGER      NOT NULL DEFAULT 0,
  duration_ms BIGINT       NOT NULL DEFAULT 0,
  ip_hash     CHAR(64)     NOT NULL,
  user_agent  VARCHAR(255),
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ns_rank ON completions (score DESC, moves ASC, hints ASC);
CREATE INDEX IF NOT EXISTS idx_ns_ip   ON completions (ip_hash, created_at);

CREATE TABLE IF NOT EXISTS saves (
  sync_hash  CHAR(64)  PRIMARY KEY,
  state      TEXT      NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
