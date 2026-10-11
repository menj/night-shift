#!/usr/bin/env node
/*
  Night Shift: automated tests. Run with: node tools/test.js

  1. parser      typed commands become the right { verb, noun, with, dir }
  2. lint        every id, exit and rule in data/world.json points at something real
  3. walkthrough tests/walkthrough.txt finishes the chapter with full score and no wasted commands
  4. spice       Off / Mild / Medium / Hot show exactly the lines they should
  5. hints       every stage has a hint, and they escalate
  6. purity      exec() never changes the state it is given (undo and autosave depend on it)
  7. dead ends   search EVERY reachable state: the win must stay reachable from all of them, and every
                 puzzle rule must be reachable. This is the "no dead ends" design rule, checked by machine.
*/
'use strict';
var fs = require('fs');
var path = require('path');
var Parser = require('../js/parser.js');
var Engine = require('../js/engine.js');
var world = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/world.json'), 'utf8'));

var failures = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.log('  FAIL: ' + msg); } }
function section(name) { console.log('\n' + name); }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
function plainLines(res) { return res.lines.map(function (l) { return Engine.plain(l.t); }); }
function walk() {
	return fs.readFileSync(path.join(__dirname, '../tests/walkthrough.txt'), 'utf8').split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l && l[0] !== '#'; });
}

/* ---------- 1. parser ---------- */
section('1. parser');
function p(input) { var c = Parser.parse(input); return [c.verb, c.noun, c.with, c.dir].join('|'); }
eq(p('take token'), 'take|token||', 'take token');
eq(p('TAKE the Token!'), 'take|token||', 'case, articles and punctuation');
eq(p('pick up the stool'), 'take|stool||', 'pick up');
eq(p('look at desk'), 'look|desk||', 'look at');
eq(p('l'), 'look|||', 'l');
eq(p('talk to mira'), 'talk|mira||', 'talk to');
eq(p('give record to mira'), 'give|record|mira|', 'give X to Y');
eq(p('use disk on terminal'), 'use|disk|terminal|', 'use X on Y');
eq(p('insert the disk into the terminal'), 'use|disk|terminal|', 'insert X into Y');
eq(p('ask moe about the mixer'), 'ask|moe|mixer|', 'ask X about Y');
eq(p('n'), 'go|||n', 'bare direction');
eq(p('go north'), 'go|||n', 'go north');
eq(p('walk to the east'), 'go|||e', 'walk to the east');
eq(p('stand on the stool'), 'climb|stool||', 'stand on');
eq(p('i'), 'inventory|||', 'inventory');
eq(p('x memo'), 'look|memo||', 'x');
eq(p('take'), 'take|||', 'verb with no noun');
eq(p(''), '|||', 'empty');
eq(Parser.parse('tkae token').suggest, 'take', 'typo: tkae -> take');
eq(Parser.parse('opne desk').suggest, 'open', 'typo: opne -> open');
eq(Parser.parse('xyzzy').suggest, '', 'nonsense gets no suggestion');
eq(Parser.parse('xyzzy').unknown, 'xyzzy', 'nonsense is flagged unknown');

/* ---------- 2. lint ---------- */
section('2. content lint');
(function () {
	var eng = new Engine(world), ids = Object.keys(eng.defs), seenAlias = {};
	Object.keys(world.rooms).forEach(function (r) {
		var room = world.rooms[r];
		Object.keys(room.exits || {}).forEach(function (d) {
			var e = room.exits[d], to = typeof e === 'string' ? e : e.to;
			ok(world.rooms[to], r + ' exit ' + d + ' leads to a real room (' + to + ')');
		});
		(JSON.stringify(room.desc).match(/\[\[([a-z]+)\|/g) || []).forEach(function (m) {
			var id = m.slice(2, -1); ok(eng.defs[id], r + ' description links to a real thing (' + id + ')');
		});
	});
	ids.forEach(function (id) {
		var d = eng.defs[id], loc = d.loc;
		ok(loc === 'gone' || world.rooms[loc] || (loc.indexOf('in:') === 0 && eng.defs[loc.slice(3)]), id + ' starts somewhere real (' + loc + ')');
		ok(d.name && d.desc, id + ' has a name and a description');
		(d.aliases || []).concat([d.name]).forEach(function (a) {
			a = a.toLowerCase();
			if (seenAlias[a] && seenAlias[a] !== id) { ok(false, 'word "' + a + '" names both ' + seenAlias[a] + ' and ' + id); }
			seenAlias[a] = id;
		});
	});
	world.rules.forEach(function (r) {
		r.on.forEach(function (e) {
			ok(eng.defs[e.noun], 'rule ' + r.id + ' names a real noun (' + e.noun + ')');
			if (e.with) { ok(eng.defs[e.with], 'rule ' + r.id + ' names a real second noun (' + e.with + ')'); }
		});
	});
	ok(world.maxScore === 4, 'maxScore matches the four scoring moments');
})();

/* ---------- 3. walkthrough ---------- */
section('3. walkthrough');
(function () {
	var eng = new Engine(world, { spice: 'mild' }), st = eng.newState(), cmds = walk(), all = [];
	cmds.forEach(function (c, i) {
		var r = eng.exec(st, c);
		st = r.state;
		var text = plainLines(r).join(' ');
		all.push(text);
		ok(!/The Glitch eats|Nothing happens\.|does not care|do not see any|cannot go that way|Did you mean|Which do you mean|what\?$/i.test(text) && text.length > 0, 'step ' + (i + 1) + ' "' + c + '" is understood and does something');
	});
	ok(st.score === 4, 'full score reached (got ' + st.score + ')');
	ok(st.ended === true, 'the chapter ends');
	ok(st.flags.complete && st.flags.moeRescued && st.flags.mixerFixed && st.flags.gotRecord, 'all four puzzle flags are set');
	ok(/CHAPTER 1 COMPLETE/.test(all[all.length - 1]), 'the last command prints the chapter ending');
	console.log('  ' + cmds.length + ' commands, final score ' + st.score + '/' + world.maxScore + ', ' + st.moves + ' moves');

	// spot checks: the puzzle tricks the design borrows
	function play(cmdsList) { var e = new Engine(world), s = e.newState(), last = ''; cmdsList.forEach(function (c) { var r = e.exec(s, c); s = r.state; last = plainLines(r).join(' '); }); return last; }
	ok(/too high/.test(play(['n', 'w', 'open cabinet'])), 'the cabinet is out of reach before the stool');
	ok(/put it down first/i.test(play(['e', 'take stool', 'w', 'n', 'w', 'climb stool'])), 'you cannot climb a stool you are carrying');
	ok(/locked/i.test(play(['w'])), 'the staff door starts locked');
	ok(/red/.test(play(['open door'])), 'the door will not open without the keycard');
	ok(/wants a token/.test(play(['n', 'play claw'])), 'the claw machine needs a token');
	ok(/decks are dead/.test(play(['give record to mira'])) === false, 'giving something you do not have is refused');
})();

/* ---------- 4. spice ---------- */
section('4. spice levels');
(function () {
	var result = {};
	['off', 'mild', 'medium', 'hot'].forEach(function (level) {
		var eng = new Engine(world, { spice: level }), st = eng.newState(), text = '', cards = [];
		walk().forEach(function (c) { var r = eng.exec(st, c); st = r.state; text += ' ' + plainLines(r).join(' '); r.events.forEach(function (e) { if (e.type === 'card') { cards.push(e.id); } }); });
		var memo = Engine.plain(eng.text(world.items.memo.read, st).join(' '));
		result[level] = { text: text, memo: memo, cards: cards, score: st.score };
		ok(st.score === 4, level + ': same score and same puzzles at every level');
	});
	ok(!/She winks|Meet me by the booth|says hi to the new attendant/.test(result.off.text + result.off.memo), 'off: no winks at all');
	ok(/She winks/.test(result.mild.text) && /says hi to the new attendant/.test(result.mild.memo), 'mild: the wink is there');
	ok(!/Meet me by the booth/.test(result.mild.text), 'mild: no fade-to-black scene yet');
	ok(/Meet me by the booth/.test(result.medium.text) && /none of the arcade's business/.test(result.medium.text), 'medium: flirty scene with a fade to black');
	ok(/Meet me by the booth/.test(result.hot.text), 'hot: includes everything below it');
	ok(result.off.cards.length === 1, 'the gallery card event fires at every level (the page decides whether to show it)');
})();

/* ---------- 5. hints ---------- */
section('5. hints');
(function () {
	var eng = new Engine(world), st = eng.newState(), seen = {}, stages = 0;
	function hint() { var r = eng.exec(st, 'hint'); st = r.state; return plainLines(r).join(' '); }
	var h1 = hint(), h2 = hint(), h3 = hint(), h4 = hint();
	ok(/AUTOMATED HELP LINE/.test(h1), 'before Moe is rescued the hints come from the help line');
	ok(h1 !== h2 && h2 !== h3, 'hints escalate');
	ok(h4 === h3, 'the last hint repeats instead of running out');
	var cmds = walk(), lastWasMoe = false;
	var e2 = new Engine(world), s2 = e2.newState();
	cmds.forEach(function (c) {
		var r = e2.exec(s2, 'hint'); var t = plainLines(r).join(' ');
		if (t.length > 5 && !seen[t]) { seen[t] = 1; stages++; }
		s2 = e2.exec(r.state, c).state;
	});
	ok(stages >= 4, 'there is a hint at every stage of the walkthrough (' + stages + ' distinct)');
	ok(/MOE:/.test(plainLines(e2.exec((function () { var s = e2.newState(); cmds.slice(0, 23).forEach(function (c) { s = e2.exec(s, c).state; }); return s; })(), 'ask moe about hint'))[0]), 'after the rescue Moe gives the hints');
	ok(/everything there is to do/.test(plainLines(e2.exec(s2, 'hint')).join(' ')), 'after the chapter the hint says so');
})();

/* ---------- 6. purity ---------- */
section('6. purity (undo and autosave rely on it)');
(function () {
	var eng = new Engine(world), st = eng.newState();
	walk().forEach(function (c) {
		var before = JSON.stringify(st);
		var r = eng.exec(st, c);
		ok(JSON.stringify(st) === before, 'exec("' + c + '") left the old state untouched');
		st = r.state;
	});
	ok(JSON.stringify(JSON.parse(JSON.stringify(st))) === JSON.stringify(st), 'a state survives a save and load round trip');
})();

/* ---------- 7. dead ends ---------- */
section('7. dead-end search (every reachable state)');
function explore(w) {
	var eng = new Engine(w), hit = {};
	var origRun = eng.runRule;
	eng.runRule = function (st, rule, out) { hit[rule.id] = 1; return origRun.call(eng, st, rule, out); };
	var start = eng.newState(), index = {}, states = [], edges = [], queue = [0];
	index[eng.hash(start)] = 0; states.push(start); edges.push([]);
	while (queue.length) {
		var i = queue.shift(), st = states[i];
		eng.candidates(st).forEach(function (c) {
			var next = eng.exec(st, c).state, h = eng.hash(next);
			if (h === eng.hash(st)) { return; }
			if (index[h] === undefined) { index[h] = states.length; states.push(next); edges.push([]); queue.push(index[h]); }
			edges[i].push(index[h]);
		});
		if (states.length > 200000) { throw new Error('state space is unexpectedly large'); }
	}
	// which states can still reach a win? walk the edges backwards from every winning state
	var back = states.map(function () { return []; });
	edges.forEach(function (outs, i) { outs.forEach(function (j) { back[j].push(i); }); });
	var good = {}, stack = [];
	states.forEach(function (s, i) { if (s.flags.complete) { good[i] = 1; stack.push(i); } });
	while (stack.length) { var k = stack.pop(); back[k].forEach(function (j) { if (!good[j]) { good[j] = 1; stack.push(j); } }); }
	return {
		eng: eng, states: states, hit: hit, wins: stack.length,
		anyWin: states.some(function (s) { return s.flags.complete; }),
		dead: states.filter(function (s, i) { return !good[i]; })
	};
}
(function () {
	var r = explore(world);
	console.log('  ' + r.states.length + ' reachable states searched');
	ok(r.anyWin, 'a winning state is reachable at all');
	ok(r.dead.length === 0, r.dead.length + ' dead-end state(s) where the chapter can no longer be won' + (r.dead[0] ? ' (e.g. room ' + r.dead[0].room + ', flags ' + Object.keys(r.dead[0].flags).join(',') + ')' : ''));
	world.rules.forEach(function (rule) { ok(r.hit[rule.id], 'puzzle rule "' + rule.id + '" can be triggered'); });
	ok(r.states.some(function (s) { return s.score === world.maxScore && s.ended; }), 'the full score is reachable');

	// negative control: break the world on purpose (climbing the stool destroys it) and make sure the search notices
	var broken = JSON.parse(JSON.stringify(world));
	broken.rules.filter(function (x) { return x.id === 'climb-stool'; })[0].effects.push({ move: ['stool', 'gone'] });
	var b = explore(broken);
	ok(b.dead.length > 0, 'negative control: the search finds the dead ends in a deliberately broken world (' + b.dead.length + ' found)');
})();

console.log('\n' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed'));
process.exit(failures ? 1 : 0);
