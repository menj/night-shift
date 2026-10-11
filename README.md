# Night Shift

A free text adventure that continues the story of [Beberd](https://github.com/menj/beberd) and [Pixel Run](https://github.com/menj/pixel-run): the arcade has closed, the Glitch is unplugging the machines, and you are the only attendant left. Hamilton, Eeny, Meeny, Miny and Moe are along for the ride.

Lives at `/arcade/night-shift/` on menj.buzz. This repo is separate from the Arcade hub and the other games; they meet only through `game.json`, the `arcade.stats` localStorage key and relative URLs.

## Play and run

Static files only, no build step. Serve the folder (the page fetches `data/ch1.json`, so `file://` will not work):

    python3 -m http.server 8000

Tap the buttons and highlighted words, or type commands (`look`, `take token`, `use disk on terminal`, `hint`, `undo`). Progress autosaves in the browser.

## Layout

    index.html        page
    css/game.css      all styling, colours are CSS variables
    js/parser.js      typed-command parser
    js/engine.js      pure engine: exec(state, input) -> new state + text
    js/ui.js          DOM, autosave, undo, settings tabs, arcade.stats
    data/ch1.json   rooms, items, people, rules, hints
    tools/test.js     engine tests incl. exhaustive dead-end search
    tools/smoke.js    headless-browser test of the real page (static mode)
    tools/server-test.js  php -S + SQLite: installer, API, admin, leaderboard and sync in the browser
    tests/walkthrough.txt   shortest full playthrough

## Database (optional, like Beberd and Pixel Run)

Without PHP or a database the game is static and saves in the browser. Open `install.php` on a PHP host to add a leaderboard and cloud saves: it supports SQLite (default), MySQL/MariaDB and PostgreSQL, writes `includes/config.local.php` (git-ignored) and locks itself afterwards. Delete `install.php` once done. The page probes `api/get-scores.php` and only shows the Leaderboard tab and cloud-save controls when the server answers.

- `api/submit-score.php`, `api/get-scores.php`: finish board (fewest moves, then fewest hints). The story engine runs in the browser, so entries are bounds-checked and rate-limited but **not replay-verified** (Beberd's are).
- `api/save.php`: cloud save by a random sync code; only a salted hash of the code is stored.
- `admin.php`: password sign-in, Overview and Leaderboard tabs, delete entries.
- `includes/`, `sql/` and `db/` carry `.htaccess` deny rules (Apache). On nginx add an equivalent deny.

## Tests

    node tools/test.js                                   # 211 checks, 0 dead ends
    NODE_PATH=$(npm root -g) node tools/smoke.js         # needs Playwright + Chromium
    NODE_PATH=$(npm root -g) node tools/server-test.js   # also needs php with pdo_sqlite

## Design rules

No dead ends (machine-checked), no sudden death, autosave and undo, clue before puzzle, no guess-the-verb (buttons, tappable words, a hint ladder), and the Spice setting is a layer that never gates the story.

## Spice

Settings, Spice tab: Off, Mild (default), Medium, Hot. Hot needs an 18+ confirmation and shows the gallery. Gallery artwork is **not** in this repo (`art/` is git-ignored); it is served separately. The page carries no ads.

## Licences

Code: see LICENSE. Special Elite font: Apache-2.0.
