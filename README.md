# Night Shift

A free five-chapter text adventure that continues the story of [Beberd](https://github.com/menj/beberd) and [Pixel Run](https://github.com/menj/pixel-run): the arcade has closed, the Glitch is unplugging the machines, and you are the only attendant left. Hamilton, Eeny, Meeny, Miny and Moe are along for the ride.

Lives at `/arcade/night-shift/` on menj.buzz. This repo is separate from the Arcade hub and the other games; they meet only through `game.json`, the `arcade.stats` localStorage key and relative URLs.

## Play and run

Static files only, no build step. Serve the folder (the page fetches `data/ch1.json`, so `file://` will not work):

    python3 -m http.server 8000

Tap the buttons and highlighted words, or type commands (`look`, `take token`, `use disk on terminal`, `hint`, `undo`). Progress autosaves in the browser.

## Layout

    index.html        page
    css/game.css      all styling, colours are CSS variables
    css/admin.css     styling for the admin page
    img/              icons, the share image and cutscene stills (img/scenes/)
    fonts/            Special Elite (WOFF2)
    art/              gallery pictures (git-ignored, served from the server)
    api/, includes/, sql/, db/   optional database layer (see below)
    install.php, admin.php       web installer and admin page (optional)
    js/install.js     installer page script
    js/parser.js      typed-command parser
    js/engine.js      pure engine: exec(state, input) -> new state + text
    js/ui.js          DOM, autosave, undo, settings tabs, arcade.stats
    data/ch1.json .. ch5.json   one world per chapter: rooms, items, people, rules, hints
    data/chapters.json   the chapter list (built by tools/build-index.js)
    tools/test.js     parser and chapter-1 engine checks (the other chapters are covered by check-chapter.js)
    tools/check-chapter.js <N>   the per-chapter checker: lint, walkthrough, Spice, hints, purity, exhaustive dead-end search
    tools/build-index.js         regenerates data/chapters.json
    tools/smoke.js    headless-browser test of the real page (static mode)
    tools/server-test.js  php -S + SQLite: installer, API, admin, leaderboard and sync in the browser
    tests/ch1.txt .. ch5.txt   the shortest full playthrough of each chapter

## Database (optional, like Beberd and Pixel Run)

Without PHP or a database the game is static and saves in the browser. Open `install.php` on a PHP host to add a leaderboard and cloud saves: it supports SQLite (default), MySQL/MariaDB and PostgreSQL, writes `includes/config.local.php` (git-ignored) and locks itself afterwards. To stop a stranger installing first, the installer asks for a setup key: create `db/install-key.txt` on the server (any secret, 8+ characters) and type its contents; the file is deleted after install. Delete `install.php` once done. The page probes `api/get-scores.php` and only shows the Leaderboard tab and cloud-save controls when the server answers.

- `api/submit-score.php`, `api/get-scores.php`: finish board (fewest moves, then fewest hints). The story engine runs in the browser, so entries are bounds-checked and rate-limited but **not replay-verified** (Beberd's are).
- `api/save.php`: cloud save by a random sync code (POST only, so the code never appears in a URL or log); only a salted hash of the code is stored.
- `admin.php`: password sign-in, Overview and Leaderboard tabs, delete entries.
- `includes/`, `sql/` and `db/` carry `.htaccess` deny rules (Apache). On nginx add an equivalent deny.

## Tests

    for n in 1 2 3 4 5; do node tools/check-chapter.js $n; done   # every chapter: 0 dead ends
    node tools/test.js                                   # parser + chapter 1 engine checks
    NODE_PATH=$(npm root -g) node tools/smoke.js         # needs Playwright + Chromium
    NODE_PATH=$(npm root -g) node tools/server-test.js   # also needs php with pdo_sqlite

## Design rules

No dead ends (machine-checked), no sudden death, autosave and undo, clue before puzzle, no guess-the-verb (buttons, tappable words, a hint ladder), and the Spice setting is a layer that never gates the story.

## Spice

Settings, Spice tab: Off, Mild (default), Medium, Hot. Hot needs an 18+ confirmation and shows the gallery. Gallery artwork is **not** in this repo (`art/` is git-ignored); it is served separately. The page carries no ads.

## Licences

Code: see LICENSE. Special Elite font: Apache-2.0.

## Cutscenes

The chapter intro (`intro` in the chapter file) and any `scene` effect in a rule, such as the ending, are paced: the text arrives one beat at a time with **Continue** and **Skip** buttons, sometimes with a pixel-art still from `img/scenes/`. While a scene is paused the other controls are inert. An intro is a list whose first entry is the title card, followed by the paced beats; an ending or other scene is authored as a `scene` effect (see DESIGN.md). Neither changes the score or the rules.

## Secrets and the gallery

Every chapter hides one optional secret task (see each chapter's `secretHint`). Hot shows a gallery of nine picture cards that unlock as you finish chapters (one to three per chapter; a chapter's extra cards open with its secret too). Each picture is **pixelated** until you find that chapter's secret, then it is fully revealed. Progress is kept in the browser (`night-shift.gallery`) across playthroughs. The art itself is not in this repo: put `art/<card-id>.png` on the server. Note the pixelation happens in the browser from the full image, so it is a game mechanic and not access control. A secret never scores, ends a chapter or changes the story.

## Chapters

1. Dead Air (the arcade)  2. Flap Zone (inside Beberd)  3. Dune Run (inside Pixel Run)  4. Cable Maze (the machine room)  5. Last Credit (the Power Room). The story, voice and cast are in DESIGN.md. Progress carries between chapters; the leaderboard counts the whole run.
