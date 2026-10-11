<?php
/**
 * Night Shift: POST /api/submit-score.php
 * Body: { "name": "PLAYER", "score": 4, "moves": 31, "hints": 0, "duration_ms": 420000 }
 * 200 { ok, rank, total } | 400 { ok:false, error } | 429 rate_limited | 503 database_unavailable (play stays local)
 */
declare(strict_types=1);
require __DIR__ . '/../includes/db.php';
require __DIR__ . '/../includes/scores.php';
$cfg = require __DIR__ . '/../includes/config.php';
apply_cors($cfg['cors_origin']);
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { send_json(['ok' => false, 'error' => 'method_not_allowed'], 405); }
$check = validate_completion(read_json_body(), $cfg);
if (!$check['ok']) { send_json($check, 400); }
$pdo = db_open($cfg, $reason);
if ($pdo === null) { send_unavailable($reason, ['ok' => false]); }
try {
    $res = record_completion($pdo, $cfg, $check['clean'], ip_hash($cfg['ip_salt'], $cfg['trusted_proxies']), substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255));
    send_json($res, $res['ok'] ? 200 : 429);
} catch (Throwable $e) {
    if (db_is_missing_table($e)) { send_unavailable('not_installed', ['ok' => false]); }
    error_log('[night-shift] submit: ' . $e->getMessage());
    send_json(['ok' => false, 'error' => 'server_error'], 500);
}
