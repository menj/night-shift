-- Night Shift: MySQL / MariaDB schema.
CREATE TABLE IF NOT EXISTS completions (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  player_name VARCHAR(40)  NOT NULL,
  score       INT          NOT NULL,
  moves       INT          NOT NULL,
  hints       INT          NOT NULL DEFAULT 0,
  duration_ms BIGINT       NOT NULL DEFAULT 0,
  ip_hash     CHAR(64)     NOT NULL,
  user_agent  VARCHAR(255) NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ns_rank (score, moves, hints),
  KEY idx_ns_ip (ip_hash, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS saves (
  sync_hash  CHAR(64)  NOT NULL PRIMARY KEY,
  state      TEXT      NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
