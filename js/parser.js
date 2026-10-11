/*
  Night Shift: command parser.

  Turns typed text into { verb, noun, with, dir } and nothing else; it does not know the world. The
  engine resolves the noun phrases against what is in reach. Rules:
  - filler words ("the", "a") are dropped, "pick up", "look at", "talk to" are understood
  - a second noun follows any preposition ("use disk on terminal", "give record to mira")
  - a bare direction ("n", "north") is a move
  - an unknown verb is matched to the nearest known one, so typos get "Did you mean TAKE?"
  Works in the browser (window.NightShiftParser) and in Node (require).
*/
(function (root, factory) {
	if (typeof module === 'object' && module.exports) { module.exports = factory(); } else { root.NightShiftParser = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	var VERB_WORDS = {
		look: ['look', 'l', 'examine', 'x', 'inspect', 'check', 'see', 'watch'],
		take: ['take', 'get', 'grab', 'pick', 'collect'],
		drop: ['drop', 'discard', 'ditch'],
		open: ['open'],
		close: ['close', 'shut'],
		read: ['read'],
		use: ['use', 'insert', 'put', 'place', 'plug', 'apply', 'attach', 'swipe', 'slot'],
		give: ['give', 'hand', 'offer', 'feed', 'show'],
		climb: ['climb', 'mount', 'stand'],
		play: ['play', 'spin', 'pull', 'crank'],
		fix: ['fix', 'repair', 'mend'],
		talk: ['talk', 'speak', 'chat'],
		ask: ['ask', 'question'],
		go: ['go', 'walk', 'run', 'head', 'move'],
		inventory: ['inventory', 'inv', 'i', 'items'],
		score: ['score'],
		hint: ['hint', 'hints', 'clue'],
		help: ['help', '?', 'commands'],
		wait: ['wait', 'z'],
		undo: ['undo'],
		save: ['save'],
		restore: ['restore', 'load'],
		again: ['again', 'g']
	};
	var DIRS = { n: 'n', north: 'n', s: 's', south: 's', e: 'e', east: 'e', w: 'w', west: 'w', u: 'u', up: 'u', d: 'd', down: 'd' };
	var ARTICLES = { a: 1, an: 1, the: 1, some: 1, my: 1, that: 1, this: 1, please: 1 };
	var PREPS = { on: 1, in: 1, into: 1, onto: 1, with: 1, to: 1, at: 1, about: 1, for: 1, from: 1, under: 1, inside: 1 };

	var WORD_TO_VERB = {};
	var ALL_WORDS = [];
	Object.keys(VERB_WORDS).forEach(function (v) {
		VERB_WORDS[v].forEach(function (w) { WORD_TO_VERB[w] = v; ALL_WORDS.push(w); });
	});

	/** Edit distance where swapping two neighbouring letters ("tkae") costs one edit, not two. */
	function distance(a, b) {
		var m = a.length, n = b.length, i, j, d = [];
		for (i = 0; i <= m; i++) { d[i] = [i]; }
		for (j = 1; j <= n; j++) { d[0][j] = j; }
		for (i = 1; i <= m; i++) {
			for (j = 1; j <= n; j++) {
				d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
				if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) { d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); }
			}
		}
		return d[m][n];
	}

	/** The closest known verb word to a typo, or '' when nothing is close enough. */
	function suggest(word) {
		var best = '', bestD = 99, tie = false;
		if (word.length < 3) { return ''; }
		ALL_WORDS.forEach(function (w) {
			if (w.length < 3) { return; }
			var d = distance(word, w);
			if (d < bestD) { best = w; bestD = d; tie = false; } else if (d === bestD && w !== best) { tie = true; }
		});
		var limit = word.length <= 4 ? 1 : 2;
		return bestD <= limit && !tie ? best : '';
	}

	function tokens(input) {
		return String(input || '').toLowerCase().replace(/[^a-z0-9?\s']/g, ' ').replace(/'/g, '').split(/\s+/).filter(Boolean);
	}

	/** Split a token list at the first preposition: [before, prepWord, after]. */
	function splitAtPrep(list) {
		for (var i = 0; i < list.length; i++) {
			if (PREPS[list[i]]) { return [list.slice(0, i), list[i], list.slice(i + 1)]; }
		}
		return [list, '', []];
	}

	function clean(list) { return list.filter(function (t) { return !ARTICLES[t]; }); }

	function parse(input) {
		var t = clean(tokens(input));
		var out = { raw: String(input || '').trim(), verb: '', noun: '', with: '', dir: '', unknown: '', suggest: '' };
		if (!t.length) { out.empty = true; return out; }

		if (DIRS[t[0]] && t.length === 1) { out.verb = 'go'; out.dir = DIRS[t[0]]; return out; }
		var verb = WORD_TO_VERB[t[0]];
		if (!verb) {
			out.unknown = t[0];
			out.suggest = suggest(t[0]);
			return out;
		}
		out.verb = verb;
		var rest = t.slice(1);
		if (verb === 'take' && rest[0] === 'up') { rest = rest.slice(1); }
		if (verb === 'take' && rest[rest.length - 1] === 'up') { rest = rest.slice(0, -1); }
		if (verb === 'go') {
			if (rest[0] === 'to') { rest = rest.slice(1); }
			if (rest.length && DIRS[rest[0]]) { out.dir = DIRS[rest[0]]; return out; }
		}
		// leading prepositions belong to the verb: "look at x", "talk to x", "climb on x"
		while (rest.length && PREPS[rest[0]] && (verb === 'look' || verb === 'talk' || verb === 'climb' || verb === 'ask')) { rest = rest.slice(1); }
		var parts = splitAtPrep(rest);
		out.noun = parts[0].join(' ');
		out.with = parts[2].join(' ');
		out.prep = parts[1];
		return out;
	}

	return { parse: parse, suggest: suggest, distance: distance, DIRS: DIRS, VERB_WORDS: VERB_WORDS };
});
