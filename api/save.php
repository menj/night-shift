<?php
/**
 * Night Shift: cloud save.
 *   GET  /api/save.php?code=<sync code>             -> 200 { state, updated_at } | 404 not_found
 *   POST /api/save.php  { code, state }             -> 200 { ok }
 * The sync code is a random secret made in the browser; only a salted hash is stored.
 */
declare(strict_types=1);
require __DIR__ . '/../includes/db.php';
require __DIR__ . '/../includes/scores.php';
$cfg = require __DIR__ . '/../includes/config.php';
apply_cors($cfg['cors_origin']);
$method = $_SERVER['REQUEST_METHOD'] ?? '';
if ($method !== 'GET' && $method !== 'POST') { send_json(['error' => 'method_not_allowed'], 405); }

$body = $method === 'POST' ? read_json_body() : [];
$code = (string)($method === 'POST' ? ($body['code'] ?? '') : ($_GET['code'] ?? ''));
if (!valid_sync_code($code)) { send_json(['ok' => false, 'error' => 'invalid_code'], 400); }
$json = '';
if ($method === 'POST') {
    if (!valid_save_state($body['state'] ?? null)) { send_json(['ok' => false, 'error' => 'invalid_state'], 400); }
    $json = json_encode($body['state'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (strlen($json) > (int)$cfg['save_max_bytes']) { send_json(['ok' => false, 'error' => 'too_large'], 413); }
}
$pdo = db_open($cfg, $reason);
if ($pdo === null) { send_unavailable($reason, ['ok' => false]); }
try {
    $hash = sync_hash($code, $cfg['ip_salt']);
    if ($method === 'GET') {
        $s = fetch_save($pdo, $hash);
        $s ? send_json($s) : send_json(['error' => 'not_found'], 404);
    }
    store_save($pdo, $hash, $json);
    send_json(['ok' => true]);
} catch (Throwable $e) {
    if (db_is_missing_table($e)) { send_unavailable('not_installed', ['ok' => false]); }
    error_log('[night-shift] save: ' . $e->getMessage());
    send_json(['ok' => false, 'error' => 'server_error'], 500);
}
