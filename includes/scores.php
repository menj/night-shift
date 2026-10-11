<?php
/**
 * Night Shift: completions (leaderboard) and cloud saves.
 *
 * Ranking: highest score first, then fewest moves, then fewest hints, then earliest.
 * Honest limit: the story engine runs in the browser, so a submission cannot be replayed
 * server-side the way Beberd's can. Submissions are bounds-checked and rate-limited, nothing more.
 */

declare(strict_types=1);

function validate_completion(array $in, array $cfg): array
{
    $name = trim(preg_replace('/\s+/u', ' ', (string)($in['name'] ?? '')));
    $len  = preg_match_all('/./us', $name);   // characters, without needing the mbstring extension (false on invalid UTF-8)
    if ($len === false || $len < $cfg['name_min_len'] || $len > $cfg['name_max_len']) { return ['ok' => false, 'error' => 'invalid_name_length']; }
    if (preg_match('/[\x00-\x1F\x7F<>&"\']/u', $name)) { return ['ok' => false, 'error' => 'invalid_name_chars']; }
    foreach (['score', 'moves'] as $k) {
        if (!isset($in[$k]) || !is_int($in[$k])) { return ['ok' => false, 'error' => 'invalid_' . $k]; }
    }
    $hints = isset($in['hints']) && is_int($in['hints']) ? $in['hints'] : 0;
    $dur   = isset($in['duration_ms']) && is_int($in['duration_ms']) ? $in['duration_ms'] : 0;
    if ($in['score'] < 0 || $in['score'] > $cfg['max_score']) { return ['ok' => false, 'error' => 'invalid_score']; }
    // Only a finished chapter counts for the board.
    if ($in['score'] < $cfg['max_score']) { return ['ok' => false, 'error' => 'chapter_not_finished']; }
    if ($in['moves'] < $cfg['min_moves'] || $in['moves'] > $cfg['max_moves']) { return ['ok' => false, 'error' => 'invalid_moves']; }
    if ($hints < 0 || $hints > $cfg['max_hints'] || $dur < 0 || $dur > 7 * 86400000) { return ['ok' => false, 'error' => 'invalid_stats']; }
    return ['ok' => true, 'clean' => ['name' => $name, 'score' => $in['score'], 'moves' => $in['moves'], 'hints' => $hints, 'duration_ms' => $dur]];
}

function is_rate_limited(PDO $pdo, string $ipHash, int $seconds): bool
{
    $since = gmdate('Y-m-d H:i:s', time() - $seconds);
    $st = $pdo->prepare('SELECT COUNT(*) FROM completions WHERE ip_hash = ? AND created_at > ?');
    $st->execute([$ipHash, $since]);
    return (int)$st->fetchColumn() > 0;
}

function record_completion(PDO $pdo, array $cfg, array $c, string $ipHash, string $ua): array
{
    if (is_rate_limited($pdo, $ipHash, (int)$cfg['rate_limit_seconds'])) { return ['ok' => false, 'error' => 'rate_limited']; }
    $pdo->prepare('INSERT INTO completions (player_name, score, moves, hints, duration_ms, ip_hash, user_agent, created_at) VALUES (?,?,?,?,?,?,?,?)')
        ->execute([$c['name'], $c['score'], $c['moves'], $c['hints'], $c['duration_ms'], $ipHash, $ua, gmdate('Y-m-d H:i:s')]);
    // Everyone ahead of this finish, ties included: the new row has the highest id, so earlier equal finishes rank first.
    $st = $pdo->prepare('SELECT COUNT(*) FROM completions WHERE score > ? OR (score = ? AND (moves < ? OR (moves = ? AND hints <= ?)))');
    $st->execute([$c['score'], $c['score'], $c['moves'], $c['moves'], $c['hints']]);
    $rank = (int)$st->fetchColumn();
    return ['ok' => true, 'rank' => $rank, 'total' => (int)$pdo->query('SELECT COUNT(*) FROM completions')->fetchColumn()];
}

function fetch_top(PDO $pdo, int $limit): array
{
    $st = $pdo->prepare('SELECT player_name AS name, score, moves, hints, duration_ms, created_at FROM completions ORDER BY score DESC, moves ASC, hints ASC, id ASC LIMIT ' . max(1, $limit));
    $st->execute();
    return $st->fetchAll();
}

/* ---- cloud saves: the sync code is a random secret; only its hash is stored ---- */

function valid_sync_code(string $code): bool { return (bool)preg_match('/^[A-Za-z0-9]{16,64}$/', $code); }
function sync_hash(string $code, string $salt): string { return hash('sha256', 'night-shift-sync|' . $salt . '|' . $code); }

function fetch_save(PDO $pdo, string $hash): ?array
{
    $st = $pdo->prepare('SELECT state, updated_at FROM saves WHERE sync_hash = ?');
    $st->execute([$hash]);
    $r = $st->fetch();
    if (!$r) { return null; }
    $state = json_decode((string)$r['state'], true);
    return is_array($state) ? ['state' => $state, 'updated_at' => $r['updated_at']] : null;
}

function store_save(PDO $pdo, string $hash, string $json): void
{
    $now = gmdate('Y-m-d H:i:s');
    $st = $pdo->prepare('UPDATE saves SET state = ?, updated_at = ? WHERE sync_hash = ?');
    $st->execute([$json, $now, $hash]);
    if ($st->rowCount() === 0) {
        try {
            $pdo->prepare('INSERT INTO saves (sync_hash, state, updated_at) VALUES (?,?,?)')->execute([$hash, $json, $now]);
        } catch (PDOException $e) {
            // lost a race with a concurrent first save: update instead
            $pdo->prepare('UPDATE saves SET state = ?, updated_at = ? WHERE sync_hash = ?')->execute([$json, $now, $hash]);
        }
    }
}

/** A save must look like a game state, so the table cannot be used as free storage. */
function valid_save_state($s): bool
{
    return is_array($s) && isset($s['room'], $s['loc'], $s['flags'], $s['score'], $s['moves'])
        && is_string($s['room']) && is_array($s['loc']) && is_array($s['flags']) && is_int($s['score']) && is_int($s['moves']);
}
