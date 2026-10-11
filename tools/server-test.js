/* Server test: starts `php -S`, installs into a temp copy (SQLite), exercises the API, the installer,
   the admin page and the browser flow (finish the game -> leaderboard, cloud save).
   Run: NODE_PATH=$(npm root -g) node tools/server-test.js */
const { spawn, execSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { chromium } = require('playwright');
const src = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ns-'));
execSync(`cp -r "${src}/." "${tmp}" && rm -rf "${tmp}/.git" "${tmp}/db/"*.sqlite* "${tmp}/includes/config.local.php"`);
const PORT = 8100 + Math.floor(Math.random() * 400), base = `http://127.0.0.1:${PORT}/`;
let n = 0, fails = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL', m); } };
const j = async (p, o) => { const r = await fetch(base + p, o); let b = null; try { b = await r.json(); } catch (e) {} return { s: r.status, b }; };
const post = (p, body) => j(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
	const php = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', tmp], { stdio: 'ignore' });
	await sleep(700);
	try {
		// before install: everything reports offline, nothing crashes
		let r = await j('api/get-scores.php'); ok(r.s === 503 && r.b.offline && r.b.reason === 'unconfigured', 'unconfigured -> 503 offline');
		r = await post('api/submit-score.php', { name: 'A', score: 24, moves: 140 }); ok(r.s === 503, 'submit offline 503');
		r = await post('api/submit-score.php', { name: '', score: 24, moves: 140 }); ok(r.s === 400, 'validation before db');
		ok((await fetch(base + 'admin.php')).status === 404, 'admin off before install');

		// install (SQLite) with an admin password
		const form = new URLSearchParams({ driver: 'sqlite', admin_password: 'correct-horse-battery' });
		let ir = await fetch(base + 'install.php', { method: 'POST', body: form });
		ok(/Installed/.test(await ir.text()), 'installer runs');
		ok(fs.existsSync(tmp + '/includes/config.local.php') && fs.existsSync(tmp + '/db/night-shift.sqlite'), 'config + sqlite written');
		ir = await fetch(base + 'install.php', { method: 'POST', body: form });
		ok(/Setup is finished/.test(await ir.text()) && !/Installed\./.test(await (await fetch(base + 'install.php')).text()), 'installer locks after install');

		// leaderboard
		r = await j('api/get-scores.php'); ok(r.s === 200 && r.b.total === 0, 'empty board 200');
		const bad = [{ name: 'x', score: 3, moves: 400 }, { name: 'x', score: 24, moves: 5 }, { name: 'x', score: 24.5, moves: 400 }, { name: '<b>', score: 24, moves: 400 }, { name: 'x', score: 24, moves: '400' }, { name: 'x'.repeat(30), score: 24, moves: 400 }];
		for (const b of bad) { r = await post('api/submit-score.php', b); ok(r.s === 400, 'rejects ' + JSON.stringify(b)); }
		r = await post('api/submit-score.php', { name: 'Ada', score: 24, moves: 140, hints: 1, duration_ms: 90000 }); ok(r.s === 200 && r.b.rank === 1, 'accepts a finish, rank 1');
		r = await post('api/submit-score.php', { name: 'Ben', score: 24, moves: 135 }); ok(r.s === 429, 'rate limited per client');
		const db = tmp + '/db/night-shift.sqlite';
		execSync(`php -r '$p=new PDO("sqlite:${db}");$p->exec("UPDATE completions SET created_at=\\"2000-01-01 00:00:00\\"");'`);
		r = await post('api/submit-score.php', { name: 'Ben', score: 24, moves: 135 }); ok(r.s === 200 && r.b.rank === 1 && r.b.total === 2, 'fewer moves ranks first');
		r = await j('api/get-scores.php?limit=5'); ok(r.b.scores[0].name === 'Ben' && r.b.scores[1].name === 'Ada' && !('ip_hash' in r.b.scores[0]), 'board order, no ip hash leaked');
		ok((await j('api/submit-score.php')).s === 405, 'GET submit 405');

		// cloud save
		const code = 'abcdefghijklmnop2345';
		const st = { room: 'lobby', loc: {}, flags: {}, score: 1, moves: 3, cards: [] };
		r = await j('api/save.php?code=' + code); ok(r.s === 404, 'no save yet');
		r = await post('api/save.php', { code, state: st }); ok(r.s === 200, 'save stored');
		r = await j('api/save.php?code=' + code); ok(r.s === 200 && r.b.state.score === 1, 'save round-trips');
		r = await post('api/save.php', { code: 'short', state: st }); ok(r.s === 400, 'short code rejected');
		r = await post('api/save.php', { code, state: { evil: 'x'.repeat(100) } }); ok(r.s === 400, 'non-state rejected');
		r = await post('api/save.php', { code, state: { ...st, flags: { pad: 'x'.repeat(20000) } } }); ok(r.s === 413, 'oversize rejected');
		r = await post('api/save.php', { code, state: { ...st, score: 2 } }); r = await j('api/save.php?code=' + code); ok(r.b.state.score === 2, 'save updates in place');
		const raw = execSync(`php -r '$p=new PDO("sqlite:${db}");echo $p->query("SELECT sync_hash FROM saves")->fetchColumn();'`).toString();
		ok(raw.length === 64 && raw.indexOf(code) === -1, 'only a hash of the code is stored');

		// protected folders
		// (php -S ignores .htaccess; assert the files are present for Apache)
		ok(['includes', 'db', 'sql'].every(d => fs.existsSync(`${tmp}/${d}/.htaccess`)), '.htaccess deny files present');

		// admin
		let ar = await fetch(base + 'admin.php'); const cookie = (ar.headers.get('set-cookie') || '').split(';')[0];
		ok(/Password/.test(await ar.text()), 'admin asks for a password');
		ar = await fetch(base + 'admin.php', { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'action=login&password=nope' });
		ok(/Wrong password/.test(await ar.text()), 'wrong password refused');
		await sleep(1100);
		ar = await fetch(base + 'admin.php', { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'action=login&password=correct-horse-battery' });
		const c2 = (ar.headers.get('set-cookie') || cookie).split(';')[0];
		ar = await fetch(base + 'admin.php?tab=scores', { headers: { cookie: c2 } }); const html = await ar.text();
		ok(/Ada/.test(html) && /Ben/.test(html), 'admin lists entries');
		const csrf = (html.match(/name="csrf" value="([0-9a-f]+)"/) || [])[1], id = (html.match(/name="id" value="(\d+)"/) || [])[1];
		let d = await fetch(base + 'admin.php?tab=scores', { method: 'POST', redirect: 'manual', headers: { cookie: c2, 'content-type': 'application/x-www-form-urlencoded' }, body: `action=delete&id=${id}&csrf=bad` });
		r = await j('api/get-scores.php'); ok(r.b.total === 2, 'delete without CSRF token refused');
		d = await fetch(base + 'admin.php?tab=scores', { method: 'POST', redirect: 'manual', headers: { cookie: c2, 'content-type': 'application/x-www-form-urlencoded' }, body: `action=delete&id=${id}&csrf=${csrf}` });
		r = await j('api/get-scores.php'); ok(r.b.total === 1, 'admin delete works with token');

		// browser: finish the game, get on the board, sync
		execSync(`php -r '$p=new PDO("sqlite:${db}");$p->exec("UPDATE completions SET created_at=\\"2000-01-01 00:00:00\\"");'`);
		const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
		const errs = [];
		const page = await (await br.newContext({ viewport: { width: 1000, height: 760 } })).newPage();
		page.on('pageerror', e => errs.push(String(e))); page.on('dialog', x => x.accept());
		await page.goto(base); await page.waitForFunction(() => window.NightShift);
		await page.waitForFunction(() => !document.getElementById('tab-board').hidden);
		ok(true, 'leaderboard tab appears when the server answers');
		const skipScenes = async () => { while (await page.$('.scene-ctl')) { await page.click('.scene-ctl >> text=Skip scene'); } };
		const type = async c => { await skipScenes(); await page.fill('#input', c); await page.press('#input', 'Enter'); };
		const idx = JSON.parse(fs.readFileSync(src + '/data/chapters.json', 'utf8')).chapters;
		const chap = n => fs.readFileSync(src + '/tests/ch' + n + '.txt', 'utf8').split('\n').map(s => s.trim()).filter(s => s && s[0] !== '#');
		const totalScore = idx.reduce((a, c) => a + c.maxScore, 0), totalMoves = idx.reduce((a, c) => a + c.minMoves, 0);
		await page.click('#open-settings'); await page.click('#sync-on'); await page.keyboard.press('Escape');
		for (let n = 1; n <= idx.length; n++) { for (const c of chap(n)) await type(c); await skipScenes(); if (n < idx.length) await page.click('button:has-text("Next chapter")'); }
		await skipScenes(); await page.fill('.namebox input', 'Tester'); await page.click('text=Post score');
		await page.waitForFunction(() => /Leaderboard: you are number/.test(document.getElementById('log').innerText));
		ok(true, 'finish posted through the page');
		await page.click('#open-settings'); await page.click('#tab-board');
		await page.waitForFunction(() => document.querySelectorAll('#board li').length >= 2);
		ok(/Tester/.test(await page.$eval('#board', e => e.innerText)), 'board tab lists the new finish');
		await page.screenshot({ path: process.argv[2] ? process.argv[2] + '/board.png' : os.tmpdir() + '/board.png' });
		await sleep(1200);
		const code2 = await page.evaluate(() => localStorage.getItem('night-shift.sync'));
		r = await j('api/save.php?code=' + code2); ok(r.s === 200 && r.b.state.run && r.b.state.chapter === idx.length, 'cloud save followed the game');
		// a fresh browser profile loads it with the code
		const p2 = await (await br.newContext()).newPage(); p2.on('dialog', x => x.accept());
		await p2.goto(base); await p2.waitForSelector('#log .scene-ctl', { timeout: 5000 }).then(() => p2.click('.scene-ctl >> text=Skip scene')).catch(() => {}); await p2.waitForFunction(() => window.NightShift && !document.getElementById('cloud').hidden === true || window.NightShift);
		await p2.waitForFunction(() => !document.getElementById('cloud').hidden);
		await p2.click('#open-settings'); await p2.fill('#sync-code', code2); await p2.click('#sync-load');
		await p2.waitForFunction(() => /Ch 5/.test(document.getElementById('score').textContent));
		ok(true, 'sync code restores the game on another device');
		ok(errs.length === 0, 'no page errors: ' + errs.join('|'));
		await br.close();
	} catch (e) { fails++; console.log('ERROR', e); }
	php.kill(); fs.rmSync(tmp, { recursive: true, force: true });
	console.log(fails ? fails + ' FAILED of ' + n : 'server: all ' + n + ' checks passed');
	process.exit(fails ? 1 : 0);
})();
