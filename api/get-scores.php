<?php
/** Night Shift: GET /api/get-scores.php?limit=10 -> 200 { scores, total } | 503 offline. */
declare(strict_types=1);
require __DIR__ . '/../includes/db.php';
require __DIR__ . '/../includes/scores.php';
$cfg = require __DIR__ . '/../includes/config.php';
apply_cors($cfg['cors_origin']);
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') { send_json(['error' => 'method_not_allowed'], 405); }
$limit = max(1, min((int)$cfg['max_limit'], (int)($_GET['limit'] ?? $cfg['default_limit'])));
$pdo = db_open($cfg, $reason);
if ($pdo === null) { send_unavailable($reason); }
try {
    send_json(['scores' => fetch_top($pdo, $limit), 'total' => (int)$pdo->query('SELECT COUNT(*) FROM completions')->fetchColumn()]);
} catch (Throwable $e) {
    if (db_is_missing_table($e)) { send_unavailable('not_installed'); }
    error_log('[night-shift] scores: ' . $e->getMessage());
    send_json(['error' => 'server_error'], 500);
}
