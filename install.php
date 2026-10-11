<?php
/**
 * Night Shift: installer. Creates the tables and writes includes/config.local.php.
 * The database is optional: skip this and the game still plays, saving in the browser.
 * It refuses to run once config.local.php exists; delete that file to install again.
 */
declare(strict_types=1);
require __DIR__ . '/includes/db.php';
$localFile = __DIR__ . '/includes/config.local.php';
$cfg = require __DIR__ . '/includes/config.php';
$done = is_file($localFile);
// Proof of server access: whoever installs must create this file (any secret, 8+ characters) on the server.
$keyFile = __DIR__ . '/db/install-key.txt';
$key = is_file($keyFile) ? trim((string)file_get_contents($keyFile)) : '';
$msg = '';
$err = '';

if (!$done && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    if (strlen($key) < 8 || !hash_equals($key, (string)($_POST['setup_key'] ?? ''))) {
        $err = 'The setup key is missing or wrong. Create db/install-key.txt on the server and enter its contents.';
    }
}
if (!$done && $err === '' && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $driver = db_driver(['driver' => $_POST['driver'] ?? 'sqlite']);
    $db = ['driver' => $driver];
    if ($driver === 'sqlite') {
        $db['path'] = 'db/night-shift.sqlite';
    } else {
        foreach (['host', 'name', 'user', 'pass'] as $k) { $db[$k] = (string)($_POST[$k] ?? ''); }
        $db['port'] = (int)($_POST['port'] ?? 0) ?: ($driver === 'pgsql' ? 5432 : 3306);   // blank means the driver's default
        if ($db['name'] === '' || $db['user'] === '' || $db['pass'] === '' || $db['pass'] === 'CHANGE_THIS_PASSWORD') { $err = 'Fill in the host, database, user and password.'; }
        elseif (!preg_match('/^[A-Za-z0-9_]+$/', $db['name'])) { $err = 'The database name may use letters, digits and underscores only.'; }
    }
    $pw = (string)($_POST['admin_password'] ?? '');
    if ($err === '' && $pw !== '' && strlen($pw) < 10) { $err = 'Use an admin password of at least 10 characters, or leave it empty to turn admin off.'; }
    if ($err === '') {
        try {
            if ($driver === 'sqlite' && !extension_loaded('pdo_sqlite')) { throw new RuntimeException('The pdo_sqlite PHP extension is not installed.'); }
            if ($driver === 'sqlite') {
                if (!is_dir(__DIR__ . '/db') && !mkdir(__DIR__ . '/db', 0750, true)) { throw new RuntimeException('Cannot create the db/ folder.'); }
            }
            $pdo = db_connect($db);
            $file = __DIR__ . '/sql/' . ['sqlite' => 'schema.sqlite.sql', 'mysql' => 'schema.sql', 'pgsql' => 'schema.pgsql.sql'][$driver];
            foreach (array_filter(array_map('trim', explode(';', (string)preg_replace('/^--.*$/m', '', (string)file_get_contents($file))))) as $sql) { $pdo->exec($sql); }
            $local = ['db' => $db, 'ip_salt' => bin2hex(random_bytes(16)), 'admin_password_hash' => $pw === '' ? '' : password_hash($pw, PASSWORD_DEFAULT)];
            $php = "<?php\n// Written by install.php. Delete this file to run the installer again.\nreturn " . var_export($local, true) . ";\n";
            if (file_put_contents($localFile, $php, LOCK_EX) === false) { throw new RuntimeException('Cannot write includes/config.local.php. Make includes/ writable, then retry.'); }
            @chmod($localFile, 0640);
            $done = true;
            @unlink($keyFile);
            $msg = 'Installed. The leaderboard and cloud saves are on.';
        } catch (Throwable $e) {
            error_log('[night-shift] install: ' . $e->getMessage());
            $err = 'Could not set up the database: ' . $e->getMessage();
        }
    }
}
function h(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }
?><!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Night Shift: Install</title>
<link rel="stylesheet" href="css/game.css"><link rel="stylesheet" href="css/admin.css"></head>
<body class="page"><main class="panel">
<h1>Night Shift: install</h1>
<?php if ($msg): ?><p class="ok"><?= h($msg) ?></p><?php endif; ?>
<?php if ($err): ?><p class="bad" role="alert"><?= h($err) ?></p><?php endif; ?>
<?php if ($done): ?>
  <p>Setup is finished. For safety, delete <code>install.php</code> from the server.</p>
  <p><a class="btn" href="./">Play</a> <a class="btn ghost" href="admin.php">Admin</a></p>
<?php else: ?>
  <p class="muted">The database is optional. It adds a leaderboard and cloud saves. SQLite needs nothing else.</p>
  <form method="post" autocomplete="off">
    <label>Setup key (the contents of <code>db/install-key.txt</code>, which you create on the server)
      <input name="setup_key" type="password" autocomplete="off"></label>
    <label>Database
      <select name="driver" id="driver">
        <option value="sqlite">SQLite (simplest)</option>
        <option value="mysql">MySQL / MariaDB</option>
        <option value="pgsql">PostgreSQL</option>
      </select></label>
    <div id="server">
      <label>Host <input name="host" value="127.0.0.1"></label>
      <label>Port <input name="port" inputmode="numeric" placeholder="3306 or 5432"></label>
      <label>Database <input name="name" value="night_shift"></label>
      <label>User <input name="user"></label>
      <label>Password <input name="pass" type="password"></label>
    </div>
    <label>Admin password (optional, 10+ characters) <input name="admin_password" type="password"></label>
    <button class="btn" type="submit">Install</button>
  </form>
  <script src="js/install.js"></script>
<?php endif; ?>
</main></body></html>
