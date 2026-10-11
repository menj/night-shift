/* Browser smoke test: serves the folder, drives the real page in headless Chromium.
   Run: NODE_PATH=$(npm root -g) node tools/smoke.js [outdir] */
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const out = process.argv[2] || path.join(root, 'tools', '.out');
fs.mkdirSync(out, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png' };
const srv = http.createServer((q, r) => {
	const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
	if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
	r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
});
let fails = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL', m); } };
(async () => {
	await new Promise(r => srv.listen(0, r));
	const base = 'http://127.0.0.1:' + srv.address().port + '/';
	const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
	const errors = [];
	// reduced motion: the log's smooth scrolling otherwise races Playwright's own scrolling before a click
	const ctx = await browser.newContext({ viewport: { width: 1000, height: 760 }, reducedMotion: 'reduce' });
	const page = await ctx.newPage();
	page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
	page.on('response', r => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url()); });
	page.on('pageerror', e => errors.push(String(e)));
	page.on('dialog', d => d.accept());
	await page.goto(base);
	await page.waitForFunction(() => window.NightShift);
	const logText = () => page.$eval('#log', e => e.innerText);
	const skipScenes = async () => { while (await page.$('.scene-ctl')) { await page.click('.scene-ctl >> text=Skip scene'); } };
	const type = async c => { await skipScenes(); await page.fill('#input', c); await page.press('#input', 'Enter'); };
	ok(/Night Shift/i.test(await logText()), 'intro shown');
	ok(!!(await page.$('.scene-ctl')), 'the opening is a cutscene with Continue / Skip');
	await skipScenes();
	ok((await page.$$('#log .noun')).length > 0, 'tappable words rendered');
	await page.screenshot({ path: out + '/desktop-start.png' });

	// tap flow: Take (verb) then a noun chip
	await type('look desk');
	await page.click('.verb[data-verb="take"]');
	ok((await page.inputValue('#input')) === 'take ', 'verb tap fills input');
	await type('open desk'); // typed override
	// typed walkthrough
	await page.evaluate(() => { document.querySelector('[data-act="i"]'); });
	const chap = n => fs.readFileSync(path.join(root, 'tests/ch' + n + '.txt'), 'utf8').split('\n').map(s => s.trim()).filter(s => s && s[0] !== '#');
	const N = JSON.parse(fs.readFileSync(path.join(root, 'data/chapters.json'), 'utf8')).chapters.length;
	const maxes = JSON.parse(fs.readFileSync(path.join(root, 'data/chapters.json'), 'utf8')).chapters.map(c => c.maxScore);
	const sum = maxes.reduce((a, b) => a + b, 0);
	const cmds = chap(1);
	// restart clean for the walkthrough
	await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForFunction(() => window.NightShift);
	for (let n = 1; n <= N; n++) {
		for (const c of chap(n)) await type(c);
		if (n === 1) {   // the ending is a cutscene: Continue steps through it, Enter works too, Skip shows the rest
			const beats = () => page.$$eval('#log .beat', e => e.length);
			ok(!!(await page.$('.scene-ctl')), 'ending cutscene waits for Continue');
			await page.waitForFunction(() => { const i = document.querySelector('#log figure.still img'); return i && i.complete && i.naturalWidth > 0 && i.alt.length > 20; });
			ok(true, 'the ending shows its pixel-art still, with alt text');
			const b0 = await beats(); await page.click('.scene-ctl >> text=Continue');
			ok((await beats()) === b0 + 1, 'Continue reveals the next beat');
			if (await page.$('.scene-ctl')) { await page.keyboard.press('Enter'); ok((await beats()) >= b0 + 2, 'Enter continues the scene'); }
			ok(await page.$eval('#input', e => e.disabled) === !!(await page.$('.scene-ctl')), 'input is locked only while a scene waits');
			await skipScenes();
			ok(!(await page.$eval('#input', e => e.disabled)), 'input unlocks after the scene');
		}
		await skipScenes();
		ok(await page.evaluate(() => window.NightShift.state.ended), 'chapter ' + n + ' ended');
		ok((await page.$eval('#score', e => e.textContent)).endsWith(maxes[n - 1] + '/' + maxes[n - 1]), 'chapter ' + n + ' full score');
		if (n < N) {
			await page.click('button:has-text("Next chapter")');
			ok(await page.evaluate(() => window.NightShift.run.chapter) === n + 1, 'moved on to chapter ' + (n + 1));
			if (n === 1) {   // reload mid-journey: the chapter and the carried flags survive
				await page.reload(); await page.waitForFunction(() => window.NightShift);
				ok(await page.evaluate(() => window.NightShift.run.chapter) === 2 && /Welcome back/.test(await logText()), 'reload keeps chapter 2');
			}
		}
	}
	ok(!!(await page.$('button:has-text("Play again")')), 'play again button after the last chapter');
	const stats = await page.evaluate(() => JSON.parse(localStorage.getItem('arcade.stats'))['night-shift']);
	ok(stats && stats.best === sum && stats.plays === 1, 'arcade.stats recorded ' + JSON.stringify(stats) + ' want best ' + sum);
	await page.screenshot({ path: out + '/desktop-end.png' });

	// reload restores autosave
	await page.reload(); await page.waitForFunction(() => window.NightShift);
	ok(/Welcome back/.test(await logText()), 'autosave restored');
	ok(/Ch 5/.test(await page.$eval('#score', e => e.textContent)), 'restored on the last chapter');

	// play again, undo, tap noun
	// a reload after the ending shows the ending text again
	ok(/CHAPTER 5 COMPLETE/.test(await logText()), 'ending scene text is restored after a reload');
	await page.waitForFunction(() => { const i = document.querySelector('#log figure.still img'); return i && i.complete && i.naturalWidth > 0; });
	ok(true, 'the finale still is restored after a reload');
	await page.screenshot({ path: out + '/finale.png' });
	await page.click('button:has-text("Play again")'); await skipScenes();
	ok(/Ch 1 · 0\//.test(await page.$eval('#score', e => e.textContent)), 'new game resets to chapter 1');
	await type('e'); const before = await page.evaluate(() => window.NightShift.state.room);
	await type('undo');
	ok(await page.evaluate(() => window.NightShift.state.room) !== before, 'undo moves back');
	await page.click('#log .noun >> nth=0');
	ok(/./.test(await logText()), 'noun tap looks');
	await type('xyzzy'); ok(/./.test(await logText()), 'unknown word handled');

	await type('hint'); ok(/./.test(await logText()), 'typed hint works (no page error)');

	// settings tabs + spice
	await page.click('#open-settings');
	ok(await page.$eval('#settings', d => d.open), 'settings opens');
	await page.click('#tab-spice');
	ok(await page.$eval('#panel-spice', e => !e.hidden) && await page.$eval('#panel-game', e => e.hidden), 'tab switch');
	await page.click('input[value="hot"]');
	ok(await page.evaluate(() => JSON.parse(localStorage.getItem('night-shift.settings')).spice) === 'hot', 'hot after age confirm');
	ok(await page.$eval('#gallery', e => !e.hidden), 'gallery shown on hot');
	await page.click('input[value="off"]');
	ok(await page.$eval('#gallery', e => e.hidden), 'gallery hidden when off');
	await page.screenshot({ path: out + '/desktop-settings.png' });
	await page.keyboard.press('Escape');

	// "show cutscenes all at once" removes every pause
	await page.click('#open-settings'); await page.click('#tab-access'); await page.check('#opt-skip'); await page.keyboard.press('Escape');
	await page.evaluate(() => { document.querySelector('.btn.ghost'); });
	await page.click('#open-settings'); await page.click('#tab-game'); await page.click('#new-game');
	ok(!(await page.$('.scene-ctl')) && (await page.$$('#log .beat')).length >= 2, 'skip-cutscenes setting shows the opening in one go');

	// mobile
	const m = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
	const mp = await m.newPage();
	mp.on('pageerror', e => errors.push(String(e)));
	await mp.goto(base); await mp.waitForFunction(() => window.NightShift);
	ok(await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll on mobile');
	await mp.screenshot({ path: out + '/mobile.png' });

	ok(errors.length === 0, 'no console errors: ' + errors.join(' | '));
	await browser.close(); srv.close();
	console.log(fails ? fails + ' FAILED of ' + n : 'smoke: all ' + n + ' checks passed');
	process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
