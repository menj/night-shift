<?php
/**
 * Night Shift: shared helpers. PDO connection (SQLite, MySQL/MariaDB, PostgreSQL),
 * JSON replies, client hashing, CORS. The game works without a database, so "no database"
 * is an expected state and is reported as 503 { offline: true }, never as a crash.
 */

declare(strict_types=1);

const NIGHT_SHIFT_DRIVERS = ['sqlite', 'mysql', 'pgsql'];

function db_driver(array $db): string
{
    $d = strtolower((string)($db['driver'] ?? 'sqlite'));
    return in_array($d, NIGHT_SHIFT_DRIVERS, true) ? $d : 'sqlite';
}

function db_sqlite_path(array $db): string
{
    $p = (string)($db['path'] ?? '');
    if ($p === '') { return ''; }
    $abs = $p[0] === '/' || $p[0] === '\\' || preg_match('~^[A-Za-z]:[\\\\/]~', $p);
    return $abs ? $p : dirname(__DIR__) . '/' . $p;
}

function db_connect(array $db, bool $selectDb = true): PDO
{
    $opts = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
        PDO::ATTR_TIMEOUT            => 3,
    ];
    switch (db_driver($db)) {
        case 'sqlite':
            $pdo = new PDO('sqlite:' . db_sqlite_path($db), null, null, $opts);
            try { $pdo->exec('PRAGMA journal_mode = WAL'); } catch (Throwable $e) { /* default journal is fine */ }
            $pdo->exec('PRAGMA busy_timeout = 5000');
            return $pdo;
        case 'pgsql':
            return new PDO(sprintf('pgsql:host=%s;port=%d;dbname=%s', $db['host'], (int)($db['port'] ?? 5432), $selectDb ? $db['name'] : 'postgres'), $db['user'], $db['pass'], $opts);
        default:
            return new PDO(sprintf('mysql:host=%s;port=%d;%scharset=%s', $db['host'], (int)($db['port'] ?? 3306), $selectDb ? 'dbname=' . $db['name'] . ';' : '', $db['charset'] ?? 'utf8mb4'), $db['user'], $db['pass'], $opts);
    }
}

/** Open the database if there is one, without ever throwing. $reason: 'unconfigured' or 'unreachable'. */
function db_open(array $cfg, ?string &$reason = null): ?PDO
{
    $reason = null;
    if (empty($cfg['configured'])) { $reason = 'unconfigured'; return null; }
    try {
        if (db_driver($cfg['db']) === 'sqlite' && !is_file(db_sqlite_path($cfg['db']))) {
            throw new RuntimeException('SQLite file not found');
        }
        return db_connect($cfg['db']);
    } catch (Throwable $e) {
        error_log('[night-shift] database unreachable: ' . $e->getMessage());
        $reason = 'unreachable';
        return null;
    }
}

function db_is_missing_table(Throwable $e): bool
{
    if (!$e instanceof PDOException) { return false; }
    return (int)($e->errorInfo[1] ?? 0) === 1146
        || ($e->errorInfo[0] ?? '') === '42P01'
        || stripos($e->getMessage(), 'no such table') !== false;
}

function send_json($payload, int $status = 200): void
{
    if (!headers_sent()) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
    }
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function send_unavailable(string $reason, array $extra = []): void
{
    send_json($extra + ['error' => 'database_unavailable', 'offline' => true, 'reason' => $reason], 503);
}

/** Client address. Proxy headers are trusted only when the TCP peer is a listed proxy. */
function client_ip(array $trusted): string
{
    $remote = (string)($_SERVER['REMOTE_ADDR'] ?? '');
    if (!filter_var($remote, FILTER_VALIDATE_IP)) { return '0.0.0.0'; }
    if (!in_array($remote, $trusted, true)) { return $remote; }
    // Single-address headers set by the proxy itself.
    foreach ([$_SERVER['HTTP_CF_CONNECTING_IP'] ?? null, $_SERVER['HTTP_X_REAL_IP'] ?? null] as $v) {
        $ip = trim((string)$v);
        if ($ip !== '' && filter_var($ip, FILTER_VALIDATE_IP)) { return $ip; }
    }
    // X-Forwarded-For is a chain a client can pre-fill, so its first entry cannot be trusted. Each proxy
    // appends the address it saw, so read from the right and stop at the first address that is not a trusted proxy.
    $chain = array_reverse(array_map('trim', explode(',', (string)($_SERVER['HTTP_X_FORWARDED_FOR'] ?? ''))));
    foreach ($chain as $ip) {
        if (!filter_var($ip, FILTER_VALIDATE_IP)) { break; }
        if (!in_array($ip, $trusted, true)) { return $ip; }
    }
    return $remote;
}

function ip_hash(string $salt, array $trusted): string
{
    return hash('sha256', client_ip($trusted) . '|' . $salt);
}

function apply_cors(string $origin): void
{
    if ($origin === '') { return; }
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Vary: Origin');
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
}

function read_json_body(): array
{
    $raw = file_get_contents('php://input');
    $data = ($raw === false || $raw === '') ? [] : json_decode($raw, true);
    return is_array($data) ? $data : [];
}
