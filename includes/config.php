<?php
/**
 * Night Shift: configuration.
 *
 * The database is optional. Without one the game plays and saves locally in the browser;
 * with one it adds a leaderboard and cloud saves ("sync code"). Open install.php to set it up:
 * it creates the tables and writes config.local.php, which wins over the defaults below and
 * survives upgrades. includes/ is denied to browsers by .htaccess.
 */

$config = [
    'version' => '0.2.0',

    'db' => [
        'driver'  => 'sqlite',            // 'sqlite', 'mysql' (MySQL/MariaDB) or 'pgsql'
        'path'    => '',                  // SQLite file, relative to the app root or absolute
        'host'    => '127.0.0.1',
        'name'    => 'night_shift',
        'user'    => 'night_shift_app',
        'pass'    => 'CHANGE_THIS_PASSWORD',
        'charset' => 'utf8mb4',
        'port'    => 3306,
    ],

    // Leave empty for same-origin hosting (menj.buzz/arcade/night-shift/).
    'cors_origin'     => '',
    'trusted_proxies' => [],

    // Validation bounds. min_moves is the length of the shortest full playthrough
    // (tests/walkthrough.txt); a "perfect" run cannot honestly be faster.
    'name_min_len'  => 1,
    'name_max_len'  => 20,
    'max_score'     => 4,
    'min_moves'     => 27,
    'max_moves'     => 5000,
    'max_hints'     => 1000,
    'rate_limit_seconds' => 5,
    'save_max_bytes'     => 16384,

    'admin_password_hash' => '',
    'ip_salt'             => 'change-this-to-a-random-string-for-your-deployment',

    'default_limit' => 10,
    'max_limit'     => 50,
];

$local = __DIR__ . '/config.local.php';
if (is_file($local)) {
    try {
        $config = array_replace_recursive($config, (array)require $local);
    } catch (Throwable $e) {
        error_log('[night-shift] ignoring unreadable config.local.php: ' . $e->getMessage());
    }
}

$config['configured'] = (($config['db']['driver'] ?? 'sqlite') === 'sqlite')
    ? !empty($config['db']['path'])
    : $config['db']['pass'] !== 'CHANGE_THIS_PASSWORD';

return $config;
