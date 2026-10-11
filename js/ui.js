/*
  Night Shift: the page.

  Wires the engine to the DOM: the story log, tappable words, verb buttons, the typed command line,
  autosave, undo, the settings dialog and the shared arcade.stats record.

  Three ways in, one pipeline: typing, tapping a verb then a word, or tapping a word alone (which looks at it)
  all end up as a command string handed to engine.exec().
*/
(function () {
	'use strict';

	var Engine = window.NightShiftEngine;
	var GAME_ID = 'night-shift';
	var KEY_SAVE = 'night-shift.save', KEY_SET = 'night-shift.settings', KEY_STATS = 'arcade.stats', KEY_SYNC = 'night-shift.sync', KEY_NAME = 'arcade_name';
	var SPICE = ['off', 'mild', 'medium', 'hot'];
	var TWO = { use: 'on', give: 'to', ask: 'about' };   // verbs that take a second word, and the joining word

	function $(id) { return document.getElementById(id); }
	var els = {
		log: $('log'), exits: $('exits'), input: $('input'), form: $('cmd'), invlist: $('invlist'), score: $('score'),
		dlg: $('settings'), openSettings: $('open-settings')
	};
	var coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;

	var world, eng, state, settings;
	var undoStack = [], cmdHistory = [], histPos = 0, lastCmd = '', pending = null;
	var meta = { hints: 0, t0: Date.now() };   // per-run extras for the leaderboard, saved with the game
	var online = false, syncTimer = 0;       // online: the optional server (leaderboard, cloud save) answered

	/* ---------- storage (every access guarded: it can be blocked or full) ---------- */
	function read(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
	function write(key, value) { try { window.localStorage.setItem(key, value); } catch (e) { /* storage unavailable */ } }
	function remove(key) { try { window.localStorage.removeItem(key); } catch (e) { /* storage unavailable */ } }

	function loadSettings() {
		var s = {};
		try { s = JSON.parse(read(KEY_SET) || '{}') || {}; } catch (e) { s = {}; }
		var spice = SPICE.indexOf(s.spice) !== -1 ? s.spice : 'mild';
		if (spice === 'hot' && !s.ageOk) { spice = 'medium'; }
		return { spice: spice, ageOk: !!s.ageOk, large: !!s.large, motion: !!s.motion };
	}
	function saveSettings() { write(KEY_SET, JSON.stringify(settings)); }
	function applySettings() {
		var root = document.documentElement;
		root.style.setProperty('--text-scale', settings.large ? '1.15' : '1');
		if (settings.motion) { root.setAttribute('data-reduce-motion', ''); } else { root.removeAttribute('data-reduce-motion'); }
		eng.setSpice(settings.spice);
	}

	function updateStats(done) {
		var all = {};
		try { all = JSON.parse(read(KEY_STATS) || '{}') || {}; } catch (e) { all = {}; }
		var mine = all[GAME_ID] || { best: 0, plays: 0, last: 0, lastPlayed: 0 };
		mine.best = Math.max(mine.best || 0, state.score);
		mine.last = state.score;
		mine.lastPlayed = Date.now();
		if (done) { mine.plays = (mine.plays || 0) + 1; }
		all[GAME_ID] = mine;
		write(KEY_STATS, JSON.stringify(all));
	}

	/* ---------- drawing ---------- */
	var MARK = /\[\[([a-z]+)\|([^\]]+)\]\]/g;
	function markup(text) {
		var frag = document.createDocumentFragment(), last = 0, m;
		MARK.lastIndex = 0;
		while ((m = MARK.exec(text))) {
			if (m.index > last) { frag.appendChild(document.createTextNode(text.slice(last, m.index))); }
			var b = document.createElement('button');
			b.type = 'button'; b.className = 'noun'; b.textContent = m[2]; b.setAttribute('data-say', eng.say(m[1]));
			b.setAttribute('aria-label', m[2] + ' (tap to ' + (pending ? pending.verb : 'look at') + ')');
			frag.appendChild(b);
			last = MARK.lastIndex;
		}
		if (last < text.length) { frag.appendChild(document.createTextNode(text.slice(last))); }
		return frag;
	}
	function scrollDown() { window.requestAnimationFrame(function () { els.log.scrollTop = els.log.scrollHeight; }); }
	function addLine(line) {
		var p;
		if (line.k === 'title') { p = document.createElement('h2'); p.className = 'room line'; p.textContent = line.t; }
		else if (line.k === 'echo') { p = document.createElement('p'); p.className = 'echo line'; p.textContent = '> ' + line.t; }
		else if (line.k === 'card') { p = document.createElement('p'); p.className = 'note line'; p.textContent = line.t; }
		else { p = document.createElement('p'); p.className = (line.k === 'note' ? 'note' : 'story') + ' line'; p.appendChild(markup(line.t)); }
		els.log.appendChild(p);
		scrollDown();
		return p;
	}
	function addLines(lines) { lines.forEach(addLine); }

	function refresh() {
		els.score.textContent = state.score + '/' + world.maxScore;
		// exits
		els.exits.textContent = '';
		eng.exitsOf(state).forEach(function (e) {
			var b = document.createElement('button');
			b.type = 'button'; b.textContent = e.name; b.setAttribute('data-go', e.name);
			if (e.locked) { b.className = 'locked'; b.setAttribute('aria-label', e.name + ' (locked)'); }
			els.exits.appendChild(b);
		});
		// what you carry
		els.invlist.textContent = '';
		var held = eng.nouns(state).filter(function (n) { return n.inv; });
		if (!held.length) { els.invlist.textContent = 'nothing'; }
		held.forEach(function (n) {
			var b = document.createElement('button');
			b.type = 'button'; b.className = 'noun'; b.textContent = n.name; b.setAttribute('data-say', n.say);
			els.invlist.appendChild(b);
		});
		renderGallery();
	}

	/* ---------- running commands ---------- */
	function autosave() {
		write(KEY_SAVE, JSON.stringify({ v: 1, state: state, meta: meta }));
		pushCloud();
	}

	/* ---------- optional server: leaderboard and cloud save (the game works without it) ---------- */
	function api(path, opts) {
		return fetch('api/' + path, opts).then(function (r) {
			return r.json().then(function (j) { return { status: r.status, body: j }; });
		});
	}
	function syncCode() { return read(KEY_SYNC) || ''; }
	function setSyncState(t) { var e = $('sync-state'); if (e) { e.textContent = t; } }
	function pushCloud() {
		if (!online || !syncCode()) { return; }
		window.clearTimeout(syncTimer);
		syncTimer = window.setTimeout(function () {
			api('save.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: syncCode(), state: state }) })
				.then(function (r) { setSyncState(r.status === 200 ? 'Cloud save is on.' : 'Cloud save failed. Your game is still saved here.'); })
				.catch(function () { setSyncState('Cloud save is offline. Your game is still saved here.'); });
		}, 800);
	}
	function newCode() {
		var a = new Uint8Array(20), out = '', set = 'abcdefghijkmnpqrstuvwxyz23456789';
		(window.crypto || window.msCrypto).getRandomValues(a);
		for (var i = 0; i < a.length; i++) { out += set.charAt(a[i] % set.length); }
		return out;
	}
	function probeServer() {
		return api('get-scores.php?limit=1').then(function (r) {
			online = r.status === 200;
		}).catch(function () { online = false; }).then(function () {
			$('tab-board').hidden = !online;
			$('cloud').hidden = !online;
			if (online) { setSyncState(syncCode() ? 'Cloud save is on. Your code: ' + syncCode() : 'Cloud save is off.'); $('sync-on').hidden = !!syncCode(); }
		});
	}
	function loadBoard() {
		var ol = $('board'), note = $('board-note');
		ol.textContent = ''; note.textContent = 'Loading...';
		api('get-scores.php?limit=10').then(function (r) {
			if (r.status !== 200) { note.textContent = 'The leaderboard is not available right now.'; return; }
			r.body.scores.forEach(function (s) {
				var li = document.createElement('li'), n = document.createElement('span'), st = document.createElement('span');
				n.textContent = s.name; st.className = 'stat'; st.textContent = s.moves + ' moves, ' + s.hints + ' hints';
				li.appendChild(n); li.appendChild(st); ol.appendChild(li);
			});
			note.textContent = r.body.scores.length ? 'Fewest moves first, then fewest hints. Scores are not verified.' : 'No finishes yet. Be the first.';
		}).catch(function () { note.textContent = 'The leaderboard is not available right now.'; });
	}
	function submitFinish(name) {
		name = String(name || '').trim().slice(0, 20);
		if (!name) { return; }
		write(KEY_NAME, name);
		var body = { name: name, score: state.score, moves: state.moves, hints: meta.hints, duration_ms: Math.min(Date.now() - meta.t0, 6 * 86400000) };
		api('submit-score.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
			.then(function (r) {
				addLine({ k: 'note', t: r.status === 200 ? 'Leaderboard: you are number ' + r.body.rank + ' of ' + r.body.total + '.' : 'Could not post to the leaderboard (' + (r.body.error || r.status).toString().replace(/_/g, ' ') + ').' });
			}).catch(function () { addLine({ k: 'note', t: 'The leaderboard is offline. Your finish is saved here.' }); });
	}
	function offerSubmit(p) {
		if (!online) { return; }
		var name = read(KEY_NAME);
		if (name) { submitFinish(name); return; }
		var box = document.createElement('div'); box.className = 'namebox';
		var inp = document.createElement('input'); inp.type = 'text'; inp.maxLength = 20; inp.placeholder = 'Name for the leaderboard'; inp.setAttribute('aria-label', 'Name for the leaderboard');
		var b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost'; b.textContent = 'Post score';
		b.addEventListener('click', function () { if (inp.value.trim()) { box.remove(); submitFinish(inp.value); } });
		box.appendChild(inp); box.appendChild(b); p.appendChild(box);
	}

	function endOfChapter() {
		var p = addLine({ k: 'note', t: '' });
		var b = document.createElement('button');
		b.type = 'button'; b.className = 'btn'; b.textContent = 'Play again';
		b.addEventListener('click', function () { newGame(false); });
		p.appendChild(b);
		return p;
	}

	function run(input) {
		input = String(input || '').trim();
		if (!input) { return; }
		if (/^(again|g)$/i.test(input) && lastCmd) { input = lastCmd; }
		addLine({ k: 'echo', t: input });
		if (cmdHistory[cmdHistory.length - 1] !== input) { cmdHistory.push(input); }
		histPos = cmdHistory.length;

		var res = eng.exec(state, input);
		if (window.NightShiftParser.parse(input).verb === 'hint' && !state.ended) { meta.hints++; }
		var ui = res.events.filter(function (e) { return e.type === 'ui'; })[0];
		if (ui) { handleUi(ui.verb); return; }

		if (res.state.moves !== state.moves) { undoStack.push(state); if (undoStack.length > 200) { undoStack.shift(); } }
		state = res.state;
		lastCmd = input;
		addLines(res.lines);
		var finished = false;
		res.events.forEach(function (e) {
			if (e.type === 'score') { updateStats(false); }
			if (e.type === 'card' && settings.spice === 'hot') {
				var meta = (world.cards || {})[e.id] || { title: e.id };
				addLine({ k: 'card', t: 'Gallery card unlocked: ' + meta.title + '. (Settings, Spice)' });
			}
			if (e.type === 'end') { finished = true; }
		});
		if (finished) { updateStats(true); offerSubmit(endOfChapter()); }
		autosave();
		refresh();
		finishInput();
	}

	function handleUi(verb) {
		if (verb === 'undo') {
			if (undoStack.length) { state = undoStack.pop(); addLine({ k: 'note', t: 'Undone.' }); autosave(); refresh(); }
			else { addLine({ k: 'note', t: 'Nothing to undo.' }); }
		} else if (verb === 'save') {
			addLine({ k: 'note', t: 'Your progress is saved automatically in this browser.' });
		} else if (verb === 'restore') {
			var s = readSave();
			if (s) { state = s; undoStack = []; addLine({ k: 'note', t: 'Restored your saved game.' }); addLines(eng.describeRoom(state)); refresh(); }
			else { addLine({ k: 'note', t: 'There is no saved game to restore.' }); }
		}
		finishInput();
	}

	function finishInput() {
		clearPending(true);
		els.input.value = '';
		if (!coarse) { els.input.focus(); }
	}

	/* ---------- tap-to-build commands ---------- */
	function setPressed(verb) {
		Array.prototype.forEach.call(document.querySelectorAll('.verb'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-verb') === verb ? 'true' : 'false'); });
	}
	function clearPending(silent) { pending = null; setPressed(''); if (!silent) { els.input.value = ''; } }
	function pickVerb(verb) {
		if (pending && pending.verb === verb) { clearPending(); return; }
		pending = { verb: verb, first: '' };
		setPressed(verb);
		els.input.value = verb + ' ';
		if (!coarse) { els.input.focus(); }
	}
	function pickNoun(say) {
		if (!pending) { run('look ' + say); return; }
		var v = pending.verb;
		if (!TWO[v]) { run(v + ' ' + say); return; }
		if (!pending.first) {
			pending.first = say;
			els.input.value = v + ' ' + say + ' ' + TWO[v] + ' ';
			if (!coarse) { els.input.focus(); }
			return;
		}
		run(v + ' ' + pending.first + ' ' + TWO[v] + ' ' + say);
	}

	/* ---------- new game / continue ---------- */
	function readSave() {
		try {
			var raw = JSON.parse(read(KEY_SAVE) || 'null');
			if (raw && raw.meta && typeof raw.meta.hints === 'number' && typeof raw.meta.t0 === 'number') { meta = { hints: raw.meta.hints, t0: raw.meta.t0 }; }
			if (raw && raw.v === 1 && raw.state && raw.state.room && world.rooms[raw.state.room] && raw.state.loc) { return raw.state; }
		} catch (e) { /* damaged save: ignore it */ }
		return null;
	}
	function intro() {
		world.intro.forEach(function (t, i) {
			var p = addLine({ k: 'story', t: t });
			if (i === 0) { p.className = 'story title-card line'; }
		});
	}
	function newGame(askFirst) {
		if (askFirst && !window.confirm('Start a new game? Your saved progress will be erased.')) { return; }
		remove(KEY_SAVE);
		state = eng.newState(); undoStack = []; lastCmd = ''; meta = { hints: 0, t0: Date.now() };
		els.log.textContent = '';
		intro();
		addLines(eng.describeRoom(state));
		autosave(); refresh(); finishInput();
		if (els.dlg.open) { els.dlg.close(); }
	}
	function start() {
		var saved = readSave();
		if (saved) {
			state = saved;
			addLine({ k: 'note', t: 'Welcome back. Your game was restored.' });
			addLines(eng.describeRoom(state));
			if (state.ended) { endOfChapter(); }
		} else {
			state = eng.newState();
			intro();
			addLines(eng.describeRoom(state));
			autosave();
		}
		refresh();
		if (!coarse) { els.input.focus(); }
	}

	/* ---------- settings dialog ---------- */
	function renderGallery() {
		var box = $('gallery');
		if (!box) { return; }
		box.hidden = settings.spice !== 'hot';
		if (box.hidden) { return; }
		var ul = $('cards');
		ul.textContent = '';
		Object.keys(world.cards || {}).forEach(function (id) {
			var meta = world.cards[id], got = state.cards.indexOf(id) !== -1;
			var li = document.createElement('li');
			if (got) {
				var img = new Image();
				img.alt = ''; img.width = 56; img.height = 72;
				img.onerror = function () { img.remove(); };
				img.src = 'art/' + id + '.png';
				li.appendChild(img);
				var t = document.createElement('span');
				t.textContent = meta.title + ' (' + meta.who + ')';
				li.appendChild(t);
			} else {
				li.className = 'locked';
				li.textContent = '? ? ?';
			}
			ul.appendChild(li);
		});
	}

	function setupSettings() {
		var dlg = els.dlg;
		if (!dlg || typeof dlg.showModal !== 'function') { els.openSettings.hidden = true; return; }
		var large = $('opt-large'), motion = $('opt-motion');
		large.checked = settings.large; motion.checked = settings.motion;
		large.addEventListener('change', function () { settings.large = large.checked; saveSettings(); applySettings(); });
		motion.addEventListener('change', function () { settings.motion = motion.checked; saveSettings(); applySettings(); });
		var radios = dlg.querySelectorAll('input[name="spice"]');
		function syncRadios() { Array.prototype.forEach.call(radios, function (r) { r.checked = r.value === settings.spice; }); }
		syncRadios();
		Array.prototype.forEach.call(radios, function (r) {
			r.addEventListener('change', function () {
				if (r.value === 'hot' && !settings.ageOk) {
					if (!window.confirm('Hot switches on adult-oriented content, including the gallery. Are you 18 or older?')) { syncRadios(); return; }
					settings.ageOk = true;
				}
				settings.spice = r.value; saveSettings(); applySettings(); refresh();
			});
		});
		$('new-game').addEventListener('click', function () { newGame(true); });

		var tabs = [$('tab-game'), $('tab-access'), $('tab-spice'), $('tab-board')], panels = [$('panel-game'), $('panel-access'), $('panel-spice'), $('panel-board')];
		function shown() { return tabs.filter(function (t) { return !t.hidden; }); }
		function select(i) {
			tabs.forEach(function (t, j) { t.setAttribute('aria-selected', j === i ? 'true' : 'false'); t.tabIndex = j === i ? 0 : -1; panels[j].hidden = j !== i; });
			tabs[i].focus();
			if (i === 3) { loadBoard(); }
		}
		tabs.forEach(function (t, i) {
			t.addEventListener('click', function () { select(i); });
			t.addEventListener('keydown', function (e) {
				var vis = shown(), at = vis.indexOf(t), to = -1;
				if (e.key === 'ArrowRight') { to = vis[(at + 1) % vis.length]; }
				if (e.key === 'ArrowLeft') { to = vis[(at + vis.length - 1) % vis.length]; }
				if (to !== -1) { e.preventDefault(); select(tabs.indexOf(to)); }
			});
		});
		$('sync-on').addEventListener('click', function () {
			write(KEY_SYNC, newCode()); $('sync-on').hidden = true;
			setSyncState('Cloud save is on. Your code: ' + syncCode());
			pushCloud();
		});
		$('sync-load').addEventListener('click', function () {
			var code = $('sync-code').value.trim();
			if (!code) { return; }
			api('save.php?code=' + encodeURIComponent(code)).then(function (r) {
				if (r.status !== 200 || !r.body.state || !world.rooms[r.body.state.room] || !r.body.state.loc || !Array.isArray(r.body.state.cards)) { setSyncState(r.status === 404 ? 'No save found for that code.' : 'Could not load that save.'); return; }
				if (!window.confirm('Replace the game on this device with the cloud save?')) { return; }
				state = r.body.state; undoStack = []; write(KEY_SYNC, code); $('sync-on').hidden = true;
				els.log.textContent = ''; addLine({ k: 'note', t: 'Loaded your cloud save.' }); addLines(eng.describeRoom(state));
				autosave(); refresh(); setSyncState('Cloud save is on. Your code: ' + code); els.dlg.close();
			}).catch(function () { setSyncState('Could not reach the server.'); });
		});
		els.openSettings.addEventListener('click', function () { syncRadios(); dlg.showModal(); });
		dlg.addEventListener('click', function (e) { if (e.target === dlg) { dlg.close(); } });
	}

	/* ---------- events ---------- */
	function wire() {
		els.form.addEventListener('submit', function (e) { e.preventDefault(); run(els.input.value); });
		els.input.addEventListener('input', function () {
			if (pending) {
				var typed = els.input.value.replace(/^\s+/, '').split(' ')[0];
				if (typed !== pending.verb) { pending = null; setPressed(''); }
			}
		});
		els.input.addEventListener('keydown', function (e) {
			if (e.key === 'ArrowUp' && cmdHistory.length) { e.preventDefault(); histPos = Math.max(0, histPos - 1); els.input.value = cmdHistory[histPos]; }
			else if (e.key === 'ArrowDown' && cmdHistory.length) { e.preventDefault(); histPos = Math.min(cmdHistory.length, histPos + 1); els.input.value = cmdHistory[histPos] || ''; }
			else if (e.key === 'Tab' && els.input.value && !e.shiftKey) { complete(e); }
			else if (e.key === 'Escape') { clearPending(); }
		});
		document.addEventListener('click', function (e) {
			var t = e.target;
			if (!t || !t.closest) { return; }
			var noun = t.closest('.noun');
			if (noun) { pickNoun(noun.getAttribute('data-say')); return; }
			var go = t.closest('[data-go]');
			if (go) { run(go.getAttribute('data-go')); return; }
			var verb = t.closest('.verb');
			if (verb) { pickVerb(verb.getAttribute('data-verb')); return; }
			var act = t.closest('.act');
			if (act) { run(act.getAttribute('data-act')); }
		});
	}

	/** Tab completes the last word to a thing you can see or carry. */
	function complete(e) {
		var m = els.input.value.match(/^(.*?)([a-z]+)$/i);
		if (!m) { return; }
		var stem = m[2].toLowerCase(), hits = [];
		eng.nouns(state).forEach(function (n) {
			var words = (eng.defs[n.id].aliases || []).concat([n.name]);
			words.forEach(function (w) { if (w.toLowerCase().indexOf(stem) === 0 && hits.indexOf(w.toLowerCase()) === -1) { hits.push(w.toLowerCase()); } });
		});
		if (hits.length) { e.preventDefault(); els.input.value = m[1] + hits[0]; }
	}

	/* ---------- boot ---------- */
	function failed(msg) {
		els.log.textContent = '';
		var p = document.createElement('p');
		p.className = 'story';
		p.textContent = msg;
		els.log.appendChild(p);
	}
	fetch('data/world.json', { cache: 'no-cache' })
		.then(function (r) { if (!r.ok) { throw new Error('world ' + r.status); } return r.json(); })
		.then(function (w) {
			world = w;
			eng = new Engine(world);
			settings = loadSettings();
			applySettings();
			setupSettings();
			wire();
			start();
			probeServer();
			window.NightShift = { engine: eng, get state() { return state; }, run: run };
		})
		.catch(function () { failed('Night Shift could not load its story file. If you opened this page straight from disk, serve the folder from a web server instead (see the README).'); });
})();
