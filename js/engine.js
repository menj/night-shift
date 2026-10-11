/*
  Night Shift: the engine.

  A small data-driven adventure engine. The world (data/ch1.json) holds rooms, items, NPCs, puzzle
  rules and hints; the engine keeps no story of its own. exec(state, input) never mutates the state you
  pass in: it returns a new one, plus the lines to print, so undo, autosave and the automated tests
  (tools/test.js) are all simple.

  Spice: any text can be tagged { "s": "mild" | "medium" | "hot", "t": "..." }; it only shows when the
  player's Spice setting is at least that high. Untagged text always shows. Text can also carry
  { "when": [conditions] } so a line changes as the story moves on.

  Works in the browser (window.NightShiftEngine) and in Node (require).
*/
(function (root, factory) {
	if (typeof module === 'object' && module.exports) { module.exports = factory(require('./parser.js')); } else { root.NightShiftEngine = factory(root.NightShiftParser); }
})(typeof self !== 'undefined' ? self : this, function (Parser) {
	'use strict';

	var RANK = { off: 0, mild: 1, medium: 2, hot: 3 };
	var DIR_NAMES = { n: 'north', s: 'south', e: 'east', w: 'west', u: 'up', d: 'down' };

	function clone(o) { return JSON.parse(JSON.stringify(o)); }
	function hashString(s) { var h = 0; for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return Math.abs(h); }

	function Engine(world, opts) {
		this.w = world;
		this.spice = (opts && opts.spice) || 'mild';
		this.defs = {};
		var self = this;
		Object.keys(world.items || {}).forEach(function (id) { self.defs[id] = Object.assign({ id: id, kind: 'item' }, world.items[id]); });
		Object.keys(world.npcs || {}).forEach(function (id) { self.defs[id] = Object.assign({ id: id, kind: 'npc' }, world.npcs[id]); });
	}

	Engine.prototype.setSpice = function (level) { this.spice = RANK[level] !== undefined ? level : 'mild'; };

	/** carry: flag names ("carry:...") earned in earlier chapters, copied into the new chapter's flags. */
	Engine.prototype.newState = function (carry) {
		var st = { room: this.w.start, loc: {}, flags: {}, score: 0, moves: 0, last: '', talk: {}, hint: {}, cards: [], ended: false };
		var self = this;
		Object.keys(this.defs).forEach(function (id) {
			var d = self.defs[id];
			st.loc[id] = d.loc || 'gone';
			if (d.open) { st.flags['open:' + id] = true; }
		});
		(carry || []).forEach(function (f) { st.flags[f] = true; });
		return st;
	};

	/* ---------- conditions and text ---------- */

	Engine.prototype.visible = function (st, id) {
		var loc = st.loc[id];
		if (loc === undefined || loc === 'gone') { return false; }
		if (loc === st.room || loc === 'inv' || loc === 'follow') { return true; }
		if (typeof loc === 'string' && loc.indexOf('in:') === 0) {
			var c = loc.slice(3);
			return !!st.flags['open:' + c] && this.visible(st, c);
		}
		return false;
	};

	Engine.prototype.check = function (cond, st) {
		var self = this;
		if (cond === undefined || cond === null) { return true; }
		if (Array.isArray(cond)) { return cond.every(function (c) { return self.check(c, st); }); }
		if (cond.not !== undefined) { return !this.check(cond.not, st); }
		if (cond.has !== undefined) { return st.loc[cond.has] === 'inv'; }
		if (cond.on !== undefined) { return st.loc[cond.on] === st.room; }
		if (cond.here !== undefined) { return this.visible(st, cond.here); }
		if (cond.follow !== undefined) { return st.loc[cond.follow] === 'follow'; }
		if (cond.flag !== undefined) { return !!st.flags[cond.flag]; }
		if (cond.room !== undefined) { return st.room === cond.room; }
		if (cond.at !== undefined) { return st.loc[cond.at[0]] === cond.at[1]; }
		return false;
	};

	/** All paragraphs of a text value that apply right now (spice level and { when } conditions). */
	Engine.prototype.text = function (t, st) {
		var out = [], self = this;
		(function walk(x) {
			if (x === undefined || x === null) { return; }
			if (Array.isArray(x)) { x.forEach(walk); return; }
			if (typeof x === 'string') { out.push(x); return; }
			if (x.s && RANK[x.s] > RANK[self.spice]) { return; }
			if (x.when && !self.check(x.when, st)) { return; }
			walk(x.t);
		})(t);
		return out;
	};

	/** The first applicable variant of a text (used for "else" messages). */
	Engine.prototype.firstText = function (t, st) {
		if (Array.isArray(t)) {
			for (var i = 0; i < t.length; i++) {
				var x = t[i];
				if (typeof x === 'string' || !x.when || this.check(x.when, st)) { return this.text(typeof x === 'string' ? x : x.t, st); }
			}
			return [];
		}
		return this.text(t, st);
	};

	Engine.prototype.say = function (id) { var d = this.defs[id]; return d ? (d.say || (d.aliases && d.aliases[0]) || d.name) : id; };
	Engine.prototype.name = function (id) { var d = this.defs[id]; return d ? d.name : id; };
	Engine.prototype.chip = function (id) { return '[[' + id + '|' + this.name(id) + ']]'; };

	/** "[[id|label]]" markup to plain text (for tests and logs). */
	Engine.plain = function (s) { return String(s).replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, '$1'); };

	/* ---------- describing ---------- */

	Engine.prototype.exitsOf = function (st) {
		var room = this.w.rooms[st.room], out = [], self = this;
		Object.keys(room.exits || {}).forEach(function (d) {
			var e = room.exits[d];
			if (typeof e === 'object' && e.quiet) { return; }
			var open = typeof e === 'string' || self.check(e.needs, st);
			out.push({ dir: d, name: DIR_NAMES[d] || d, locked: !open });
		});
		return out;
	};

	Engine.prototype.contentsLine = function (st, id) {
		var d = this.defs[id], self = this, found = [];
		Object.keys(this.defs).forEach(function (k) { if (st.loc[k] === 'in:' + id) { found.push(self.chip(k)); } });
		if (!found.length || !st.flags['open:' + id]) { return ''; }
		return (d.contentsLabel || 'Inside') + ': ' + found.join(', ') + '.';
	};

	Engine.prototype.describeRoom = function (st) {
		var room = this.w.rooms[st.room], self = this, lines = [{ k: 'title', t: room.name }];
		this.text(room.desc, st).forEach(function (t) { lines.push({ k: 'text', t: t }); });
		Object.keys(this.defs).forEach(function (id) {
			var d = self.defs[id];
			if (d.kind !== 'npc' || !self.visible(st, id)) { return; }
			var t = st.loc[id] === 'follow' ? (d.hereFollow || d.here) : d.here;
			if (t) { lines.push({ k: 'text', t: t }); }
		});
		var seen = [];
		Object.keys(this.defs).forEach(function (id) {
			var d = self.defs[id];
			if (d.kind === 'item' && !d.fixed && st.loc[id] === st.room) { seen.push(self.chip(id)); }
		});
		if (seen.length) { lines.push({ k: 'text', t: 'You can see: ' + seen.join(', ') + '.' }); }
		Object.keys(this.defs).forEach(function (id) {
			var d = self.defs[id];
			if (d.container && st.loc[id] === st.room) {
				var c = self.contentsLine(st, id);
				if (c) { lines.push({ k: 'text', t: c }); }
			}
		});
		var ex = this.exitsOf(st).map(function (e) { return e.name + (e.locked ? ' (locked)' : ''); });
		if (ex.length) { lines.push({ k: 'note', t: 'Exits: ' + ex.join(', ') + '.' }); }
		return lines;
	};

	/** Words the player can tap or type right now. */
	Engine.prototype.nouns = function (st) {
		var self = this, out = [];
		Object.keys(this.defs).forEach(function (id) {
			if (self.visible(st, id)) { out.push({ id: id, say: self.say(id), name: self.name(id), kind: self.defs[id].kind, inv: st.loc[id] === 'inv' }); }
		});
		return out;
	};

	/* ---------- resolving words to things ---------- */

	Engine.prototype.resolve = function (st, phrase) {
		var self = this;
		phrase = String(phrase || '').trim();
		if (!phrase) { return { none: true }; }
		if (/^(it|him|her|them)$/.test(phrase)) {
			if (st.last && this.visible(st, st.last)) { return { id: st.last }; }
			return { error: 'You are not sure what you mean by "' + phrase + '".' };
		}
		var ptoks = phrase.split(' '), best = 0, hits = [];
		Object.keys(this.defs).forEach(function (id) {
			if (!self.visible(st, id)) { return; }
			var d = self.defs[id], names = [d.name.toLowerCase()].concat(d.aliases || []), score = 0;
			names.forEach(function (a) {
				a = a.toLowerCase();
				if (a === phrase) { score = Math.max(score, 2); return; }
				var atoks = a.split(' ');
				if (ptoks.every(function (t) { return atoks.indexOf(t) !== -1; })) { score = Math.max(score, 1); }
			});
			if (score > best) { best = score; hits = [id]; } else if (score === best && score > 0) { hits.push(id); }
		});
		if (hits.length === 1) { st.last = hits[0]; return { id: hits[0] }; }
		if (hits.length > 1) { return { error: 'Which do you mean: ' + hits.map(function (h) { return self.name(h); }).join(' or ') + '?' }; }
		return { error: 'You do not see any "' + phrase + '" here.' };
	};

	/* ---------- running a command ---------- */

	function Out(spiceEngine, st) {
		this.lines = [];
		this.events = [];
	}
	Out.prototype.text = function (t) { this.lines.push({ k: 'text', t: t }); };
	/** A cutscene beat: the page shows these one at a time with Continue and Skip. */
	Out.prototype.beat = function (t) { this.lines.push({ k: 'beat', t: t }); };
	Out.prototype.note = function (t) { this.lines.push({ k: 'note', t: t }); };

	Engine.prototype.exec = function (state, input) {
		var st = clone(state), out = new Out(), cmd = Parser.parse(input), self = this;
		function texts(t) { self.text(t, st).forEach(function (x) { out.text(x); }); }
		if (cmd.empty) { out.note('Say something. (HELP lists the commands.)'); return { state: st, lines: out.lines, events: out.events }; }
		if (cmd.unknown) {
			if (cmd.suggest) { out.note('Did you mean ' + cmd.suggest.toUpperCase() + '? (You typed "' + cmd.unknown + '".)'); }
			else { out.text(this.w.glitch[hashString(cmd.raw) % this.w.glitch.length]); }
			return { state: st, lines: out.lines, events: out.events };
		}
		var v = cmd.verb;

		// commands handled by the page, not the world
		if (v === 'undo' || v === 'save' || v === 'restore' || v === 'again') { out.events.push({ type: 'ui', verb: v }); return { state: st, lines: out.lines, events: out.events }; }
		if (v === 'help') { texts(this.w.help); return { state: st, lines: out.lines, events: out.events }; }
		if (v === 'score') { out.note('Score: ' + st.score + ' of ' + this.w.maxScore + '.'); return { state: st, lines: out.lines, events: out.events }; }
		if (v === 'hint') { this.hintInto(st, out); return { state: st, lines: out.lines, events: out.events }; }

		if (st.ended && v !== 'look' && v !== 'inventory') { out.note('The chapter is over. You can still LOOK around; start a new game from the settings menu.'); return { state: st, lines: out.lines, events: out.events }; }
		st.moves++;
		var noun = this.resolve(st, cmd.noun), withR = this.resolve(st, cmd.with);

		if (v === 'inventory') {
			var held = Object.keys(this.defs).filter(function (id) { return st.loc[id] === 'inv'; });
			out.text(held.length ? 'You are carrying: ' + held.map(function (id) { return self.chip(id); }).join(', ') + '.' : 'You are carrying nothing.');
			return { state: st, lines: out.lines, events: out.events };
		}
		if (v === 'wait') { out.text('Time passes. Somewhere in the dark, a cabinet hums to itself.'); return { state: st, lines: out.lines, events: out.events }; }

		if (v === 'go') {
			this.go(st, cmd.dir, out);
			return { state: st, lines: out.lines, events: out.events };
		}
		if (v === 'look' && noun.none) {
			this.describeRoom(st).forEach(function (l) { out.lines.push(l); });
			return { state: st, lines: out.lines, events: out.events };
		}

		// everything below needs the player's words to make sense
		if (noun.error) { out.text(noun.error); return { state: st, lines: out.lines, events: out.events }; }
		if (withR.error && !(v === 'ask')) { out.text(withR.error); return { state: st, lines: out.lines, events: out.events }; }

		// puzzle rules get the first say
		var rule = this.matchRule(v, noun.id, withR.id);
		if (rule) { this.runRule(st, rule, out); return { state: st, lines: out.lines, events: out.events }; }

		this.generic(st, cmd, noun, withR, out);
		return { state: st, lines: out.lines, events: out.events };
	};

	Engine.prototype.matchRule = function (verb, nounId, withId) {
		var rules = this.w.rules || [];
		for (var i = 0; i < rules.length; i++) {
			var on = rules[i].on;
			for (var j = 0; j < on.length; j++) {
				var e = on[j];
				if (e.verb.indexOf(verb) === -1) { continue; }
				if (e.noun === nounId && (e.with ? e.with === withId : !withId)) { return rules[i]; }
				if (e.with && e.noun === withId && e.with === nounId) { return rules[i]; }
			}
		}
		return null;
	};

	Engine.prototype.runRule = function (st, rule, out) {
		var self = this;
		function texts(t) { self.text(t, st).forEach(function (x) { out.text(x); }); }
		if (rule.skipIf && this.check(rule.skipIf, st)) { texts(rule.skipText); return; }
		if (rule.requires && !this.check(rule.requires, st)) { this.firstText(rule.else, st).forEach(function (x) { out.text(x); }); return; }
		(rule.effects || []).forEach(function (e) {
			if (e.say !== undefined) { texts(e.say); }
			if (e.scene !== undefined) {
				if (e.still) { out.lines.push({ k: 'still', t: e.alt || '', src: e.still }); }   // an illustration shown above the beats
				self.text(e.scene, st).forEach(function (x) { out.beat(x); });
				out.events.push({ type: 'scene' });
			}
			if (e.flag) { st.flags[e.flag] = true; }
			if (e.unflag) { delete st.flags[e.unflag]; }
			if (e.move) { st.loc[e.move[0]] = e.move[1]; }
			if (e.give) { st.loc[e.give] = 'inv'; }
			if (e.follow) { st.loc[e.follow] = 'follow'; }
			if (e.unlock) { st.flags['unlock:' + e.unlock] = true; }
			if (e.open) {
				st.flags['open:' + e.open] = true;
				var d = self.defs[e.open];
				if (d.openText) { out.text(d.openText); }
				var c = self.contentsLine(st, e.open);
				if (c) { out.text(c); }
			}
			if (e.score) { st.score += e.score; out.note('Score: ' + st.score + ' of ' + self.w.maxScore + '.'); out.events.push({ type: 'score', score: st.score }); }
			if (e.card) {
				if (st.cards.indexOf(e.card) === -1) { st.cards.push(e.card); }
				out.events.push({ type: 'card', id: e.card });
			}
			if (e.end) { st.ended = true; out.events.push({ type: 'end' }); }
		});
	};

	Engine.prototype.go = function (st, dir, out) {
		var room = this.w.rooms[st.room], e = room.exits && room.exits[dir];
		if (!e) { out.text('You cannot go that way.'); return; }
		if (typeof e === 'object' && !this.check(e.needs, st)) { out.text(e.blocked || 'Something stops you.'); return; }
		var to = typeof e === 'string' ? e : e.to;
		delete st.flags.onStool; // stepping off the stool
		st.room = to;
		this.describeRoom(st).forEach(function (l) { out.lines.push(l); });
	};

	Engine.prototype.generic = function (st, cmd, noun, withR, out) {
		var self = this, v = cmd.verb, id = noun.id, d = id && this.defs[id];
		function texts(t) { self.text(t, st).forEach(function (x) { out.text(x); }); }
		function needNoun(verbWord) { out.text(verbWord + ' what?'); }

		switch (v) {
			case 'look':
				texts(d.desc);
				if (d.container) { var c = this.contentsLine(st, id); if (c) { out.text(c); } }
				return;
			case 'take':
				if (!id) { return needNoun('Take'); }
				if (d.kind === 'npc') { out.text(d.name + ' would not appreciate that.'); return; }
				if (d.fixed) { out.text('You cannot take that.'); return; }
				if (st.loc[id] === 'inv') { out.text('You already have it.'); return; }
				st.loc[id] = 'inv';
				if (id === 'stool') { delete st.flags.onStool; }
				if (d.takeText) { out.text(d.takeText); } else { out.text('Taken.'); }
				if (d.points && !st.flags['pts:' + id]) {
					st.flags['pts:' + id] = true;
					st.score += d.points;
					out.note('Score: ' + st.score + ' of ' + this.w.maxScore + '.');
					out.events.push({ type: 'score', score: st.score });
				}
				return;
			case 'drop':
				if (!id) { return needNoun('Drop'); }
				if (st.loc[id] !== 'inv') { out.text('You are not carrying that.'); return; }
				st.loc[id] = st.room;
				out.text('Dropped.');
				return;
			case 'open':
				if (!id) { return needNoun('Open'); }
				if (!d.container) { out.text('That does not open.'); return; }
				if (st.flags['open:' + id]) { out.text('It is already open.'); return; }
				st.flags['open:' + id] = true;
				if (d.openText) { out.text(d.openText); }
				var oc = this.contentsLine(st, id);
				out.text(oc || 'It is empty.');
				return;
			case 'close':
				if (!id) { return needNoun('Close'); }
				if (!d.container || !st.flags['open:' + id]) { out.text('It is not open.'); return; }
				delete st.flags['open:' + id];
				out.text('Closed.');
				return;
			case 'read':
				if (!id) { return needNoun('Read'); }
				if (d.read) { texts(d.read); } else { out.text('There is nothing to read there.'); }
				return;
			case 'talk':
				if (!id) { return needNoun('Talk to'); }
				if (d.kind !== 'npc') { out.text('That is not much of a talker.'); return; }
				this.talkTo(st, id, out);
				return;
			case 'ask':
				if (!id) { return needNoun('Ask'); }
				if (d.kind !== 'npc') { out.text('That is not much of a talker.'); return; }
				this.askAbout(st, id, cmd.with, out);
				return;
			case 'give':
				if (!id) { return needNoun('Give'); }
				if (st.loc[id] !== 'inv') { out.text('You are not carrying that.'); return; }
				out.text(withR.id ? this.name(withR.id) + ' does not seem to want that.' : 'Give it to whom?');
				return;
			case 'use':
				if (!id) { return needNoun('Use'); }
				if (!withR.id && this.hasRuleWith(id)) { out.text('Use ' + this.name(id) + ' on what?'); return; }
				out.text(this.w.glitch[hashString(cmd.raw) % this.w.glitch.length]);
				return;
			default:
				if (!id && (v === 'climb' || v === 'play' || v === 'fix')) { return needNoun(v.charAt(0).toUpperCase() + v.slice(1)); }
				out.text(this.w.glitch[hashString(cmd.raw) % this.w.glitch.length]);
		}
	};

	Engine.prototype.hasRuleWith = function (id) {
		return (this.w.rules || []).some(function (r) { return r.on.some(function (e) { return e.noun === id && e.with; }); });
	};

	Engine.prototype.talkTo = function (st, id, out) {
		var d = this.defs[id], self = this;
		var entries = (d.talk || []).filter(function (e) {
			return (!e.s || RANK[e.s] <= RANK[self.spice]) && (!e.when || self.check(e.when, st));
		});
		if (!entries.length) { out.text(d.name + ' has nothing to say right now.'); return; }
		var i = st.talk[id] || 0;
		st.talk[id] = i + 1;
		this.text(entries[i % entries.length].t, st).forEach(function (x) { out.text(x); });
	};

	Engine.prototype.askAbout = function (st, id, topicPhrase, out) {
		var d = this.defs[id], topic = String(topicPhrase || '').toLowerCase();
		if (!topic) { this.talkTo(st, id, out); return; }
		var topics = d.topics || {}, keys = Object.keys(topics);
		for (var i = 0; i < keys.length; i++) {
			if (topic.indexOf(keys[i]) !== -1) {
				if (topics[keys[i]] === 'HINT') { this.hintInto(st, out); } else { out.text(topics[keys[i]]); }
				return;
			}
		}
		out.text(d.name + ' shrugs. "Never heard of it."');
	};

	Engine.prototype.hintInto = function (st, out) {
		var stages = this.w.hints, self = this;
		for (var i = 0; i < stages.length; i++) {
			if (this.check(stages[i].done, st)) { continue; }
			var idx = st.hint[i] || 0, lines = stages[i].lines;
			var line = lines[Math.min(idx, lines.length - 1)];
			st.hint[i] = Math.min(idx + 1, lines.length);
			out.text((st.loc.moe === 'follow' ? 'MOE: ' : 'AUTOMATED HELP LINE: ') + line);
			return;
		}
		out.text('You have done everything there is to do in this chapter.');
	};

	/* ---------- helpers for tests and the page ---------- */

	/** Every command worth trying from here: used by the dead-end search in tools/test.js. */
	Engine.prototype.candidates = function (st) {
		var self = this, cmds = {}, room = this.w.rooms[st.room];
		Object.keys(room.exits || {}).forEach(function (d) { cmds[d] = 1; });
		Object.keys(this.defs).forEach(function (id) {
			if (!self.visible(st, id)) { return; }
			var d = self.defs[id];
			if (d.kind === 'item' && !d.fixed && st.loc[id] !== 'inv') { cmds['take ' + self.say(id)] = 1; }
			if (d.container && !st.flags['open:' + id]) { cmds['open ' + self.say(id)] = 1; }
			if (id === 'stool' && st.loc[id] === 'inv') { cmds['drop stool'] = 1; }
		});
		(this.w.rules || []).forEach(function (r) {
			r.on.forEach(function (e) {
				cmds[e.verb[0] + ' ' + self.say(e.noun) + (e.with ? ' on ' + self.say(e.with) : '')] = 1;
			});
		});
		return Object.keys(cmds);
	};

	/** A stable fingerprint of the parts of a state that matter to the story. */
	Engine.prototype.hash = function (st) {
		var locs = Object.keys(st.loc).sort().map(function (k) { return k + '=' + st.loc[k]; }).join(',');
		var flags = Object.keys(st.flags).filter(function (k) { return st.flags[k]; }).sort().join(',');
		return st.room + '|' + locs + '|' + flags + '|' + st.score + '|' + (st.ended ? 1 : 0);
	};

	Engine.clone = clone;
	return Engine;
});
