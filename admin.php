<?php
/**
 * Night Shift: admin. Needs the admin password hash set by install.php.
 * Tabs: Overview (health and counts), Leaderboard (review and delete entries).
 */
declare(strict_types=1);
require __DIR__ . '/includes/db.php';
$cfg = require __DIR__ . '/includes/config.php';
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');
header("Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'");

function h(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }
$enabled = !empty($cfg['admin_password_hash']) && is_string($cfg['admin_password_hash']);
if (!$enabled) { http_response_code(404); exit('Admin is not enabled.'); }

session_name('nightshift_admin');
session_set_cookie_params(['path' => rtrim(str_replace('\\', '/', dirname((string)($_SERVER['SCRIPT_NAME'] ?? '/'))), '/') . '/', 'httponly' => true, 'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off', 'samesite' => 'Strict']);
session_start();
$token = hash('sha256', 'night-shift-admin|' . $cfg['admin_password_hash']);
$in = ($_SESSION['ok'] ?? '') === $token;
$err = '';

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $act = (string)($_POST['action'] ?? '');
    if ($act === 'login') {
        // Slow down guessing: one attempt per second per session.
        if (time() - (int)($_SESSION['last'] ?? 0) < 1) { $err = 'Wait a moment and try again.'; }
        else {
            $_SESSION['last'] = time();
            if (password_verify((string)($_POST['password'] ?? ''), $cfg['admin_password_hash'])) {
                session_regenerate_id(true);
                $_SESSION['ok'] = $token; $_SESSION['csrf'] = bin2hex(random_bytes(16)); $in = true;
            } else { $err = 'Wrong password.'; }
        }
    } elseif ($in && hash_equals((string)($_SESSION['csrf'] ?? ''), (string)($_POST['csrf'] ?? ''))) {
        if ($act === 'logout') { $_SESSION = []; session_destroy(); header('Location: admin.php'); exit; }
        $pdo = db_open($cfg, $reason);
        if ($pdo && $act === 'delete') { $pdo->prepare('DELETE FROM completions WHERE id = ?')->execute([(int)($_POST['id'] ?? 0)]); }
        header('Location: admin.php?tab=' . (($_GET['tab'] ?? '') === 'scores' ? 'scores' : 'overview')); exit;
    } elseif ($in) { $err = 'Session expired. Reload the page.'; }
}
$tab = ($_GET['tab'] ?? 'overview') === 'scores' ? 'scores' : 'overview';
?><!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Night Shift: Admin</title>
<link rel="stylesheet" href="css/game.css"><link rel="stylesheet" href="css/admin.css"></head>
<body class="page"><main class="panel">
<h1>Night Shift admin</h1>
<?php if ($err): ?><p class="bad" role="alert"><?= h($err) ?></p><?php endif; ?>
<?php if (!$in): ?>
  <form method="post"><input type="hidden" name="action" value="login">
    <label>Password <input type="password" name="password" autofocus autocomplete="current-password"></label>
    <button class="btn" type="submit">Sign in</button></form>
<?php else:
  $pdo = db_open($cfg, $reason); $rows = []; $counts = null; $dberr = $pdo ? '' : (string)$reason;
  if ($pdo) { try {
      $counts = ['completions' => (int)$pdo->query('SELECT COUNT(*) FROM completions')->fetchColumn(), 'saves' => (int)$pdo->query('SELECT COUNT(*) FROM saves')->fetchColumn()];
      if ($tab === 'scores') { $rows = $pdo->query('SELECT id, player_name, score, moves, hints, created_at FROM completions ORDER BY score DESC, moves ASC, hints ASC, id ASC LIMIT 200')->fetchAll(); }
  } catch (Throwable $e) { $dberr = db_is_missing_table($e) ? 'not_installed' : 'error'; error_log('[night-shift] admin: ' . $e->getMessage()); } }
  $csrf = h((string)$_SESSION['csrf']); ?>
  <nav class="tabbar" aria-label="Admin sections">
    <a href="admin.php?tab=overview"<?= $tab === 'overview' ? ' aria-current="page"' : '' ?>>Overview</a>
    <a href="admin.php?tab=scores"<?= $tab === 'scores' ? ' aria-current="page"' : '' ?>>Leaderboard</a>
  </nav>
  <?php if ($dberr): ?><p class="bad">Database unavailable (<?= h($dberr) ?>). The game still works and saves in the browser.</p><?php endif; ?>
  <?php if ($tab === 'overview' && $counts): ?>
    <p>Version <?= h((string)$cfg['version']) ?> &middot; driver <?= h(db_driver($cfg['db'])) ?></p>
    <p>Completions: <b><?= $counts['completions'] ?></b> &middot; Cloud saves: <b><?= $counts['saves'] ?></b></p>
  <?php elseif ($tab === 'scores' && $counts): ?>
    <table class="scores"><thead><tr><th>#</th><th>Player</th><th>Score</th><th>Moves</th><th>Hints</th><th>When (UTC)</th><th></th></tr></thead><tbody>
    <?php foreach ($rows as $i => $r): ?>
      <tr><td><?= $i + 1 ?></td><td><?= h((string)$r['player_name']) ?></td><td><?= (int)$r['score'] ?></td><td><?= (int)$r['moves'] ?></td><td><?= (int)$r['hints'] ?></td><td><?= h((string)$r['created_at']) ?></td>
      <td><form method="post" action="admin.php?tab=scores"><input type="hidden" name="csrf" value="<?= $csrf ?>"><input type="hidden" name="action" value="delete"><input type="hidden" name="id" value="<?= (int)$r['id'] ?>"><button class="btn ghost" type="submit">Delete</button></form></td></tr>
    <?php endforeach; if (!$rows): ?><tr><td colspan="7" class="muted">No entries yet.</td></tr><?php endif; ?>
    </tbody></table>
  <?php endif; ?>
  <form method="post"><input type="hidden" name="csrf" value="<?= $csrf ?>"><input type="hidden" name="action" value="logout"><button class="btn ghost" type="submit">Sign out</button></form>
<?php endif; ?>
</main></body></html>
