#!/usr/bin/env node
/*
  Night Shift: checks ONE chapter file, whatever its story.  node tools/check-chapter.js <n>
  Reads data/ch<n>.json and tests/ch<n>.txt (the shortest full playthrough, one command per line).

  Rules every chapter must meet (the design rules, checked by machine):
   - lint        every id, exit, rule, hint and link points at something real; no two things share a word
   - walkthrough the playthrough is understood at every step, reaches full score, ends the chapter
                 and the last line says "CHAPTER <n> COMPLETE"
   - spice       same score and puzzles at every level; Mild adds winks; Off removes every tagged line
   - hints       a hint exists at every stage of the walkthrough and they escalate
   - purity      exec() never mutates the state it is given
   - dead ends   every reachable state can still reach the win (flag "complete"); every rule is reachable
                 (plus a negative control that proves the search can fail)
*/
'use strict';
var fs = require('fs'), path = require('path');
var Engine = require('../js/engine.js');
var n = parseInt(process.argv[2], 10);
if (!n) { console.log('usage: node tools/check-chapter.js <chapter number>'); process.exit(2); }
var root = path.join(__dirname, '..');
var world = JSON.parse(fs.readFileSync(path.join(root, 'data/ch' + n + '.json'), 'utf8'));
var cmds = fs.readFileSync(path.join(root, 'tests/ch' + n + '.txt'), 'utf8').split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l && l[0] !== '#'; });
var carry = world.carry || [];

var failures = 0, checks = 0;
function ok(c, m) { checks++; if (!c) { failures++; console.log('  FAIL: ' + m); } }
function plain(res) { return res.lines.map(function (l) { return Engine.plain(l.t); }); }
var BAD = /The Glitch eats|Nothing happens\.|does not care|do not see any|cannot go that way|Did you mean|Which do you mean|what\?$/i;

console.log(world.chapter);

/* lint */
(function () {
	var eng = new Engine(world), seen = {};
	ok(typeof world.maxScore === 'number' && world.maxScore >= 3 && world.maxScore <= 6, 'maxScore is 3 to 6');
	ok(world.rooms[world.start], 'start room exists');
	ok(Object.keys(world.rooms).length >= 5 && Object.keys(world.rooms).length <= 10, 'between 5 and 10 rooms');
	ok(Array.isArray(world.intro) && world.intro.length >= 2, 'has an intro');
	Object.keys(world.rooms).forEach(function (r) {
		var room = world.rooms[r];
		Object.keys(room.exits || {}).forEach(function (d) {
			var e = room.exits[d], to = typeof e === 'string' ? e : e.to;
			ok(world.rooms[to], r + ' exit ' + d + ' leads to a real room (' + to + ')');
		});
		(JSON.stringify(room.desc).match(/\[\[([a-z]+)\|/g) || []).forEach(function (m) { ok(eng.defs[m.slice(2, -1)], r + ' description links to a real thing (' + m.slice(2, -1) + ')'); });
	});
	Object.keys(eng.defs).forEach(function (id) {
		var d = eng.defs[id], loc = d.loc;
		ok(loc === 'gone' || world.rooms[loc] || (loc && loc.indexOf('in:') === 0 && eng.defs[loc.slice(3)]), id + ' starts somewhere real (' + loc + ')');
		ok(d.name && d.desc, id + ' has a name and a description');
		(d.aliases || []).concat([d.name]).forEach(function (a) {
			a = a.toLowerCase();
			if (seen[a] && seen[a] !== id) { ok(false, 'word "' + a + '" names both ' + seen[a] + ' and ' + id); }
			seen[a] = id;
		});
	});
	world.rules.forEach(function (r) {
		ok(r.id, 'every rule has an id');
		r.on.forEach(function (e) { ok(eng.defs[e.noun], 'rule ' + r.id + ' names a real noun (' + e.noun + ')'); if (e.with) { ok(eng.defs[e.with], 'rule ' + r.id + ' names a real second noun (' + e.with + ')'); } });
	});
	ok(world.rules.some(function (r) { return JSON.stringify(r.effects).indexOf('"end"') !== -1; }), 'some rule ends the chapter');
	ok(Array.isArray(world.hints) && world.hints.length >= 3, 'at least 3 hint stages');
	ok(world.cards && Object.keys(world.cards).length >= 1, 'declares its gallery card');
	ok(world.rules.some(function (r) { return JSON.stringify(r.effects).indexOf('carry:') !== -1; }) || n === 5, 'sets a carry: flag for the next chapter (except the last)');
})();

/* walkthrough */
var finalState;
(function () {
	var eng = new Engine(world, { spice: 'mild' }), st = eng.newState(carry), all = [];
	cmds.forEach(function (c, i) {
		var r = eng.exec(st, c); st = r.state;
		var t = plain(r).join(' '); all.push(t);
		ok(t.length > 0 && !BAD.test(t), 'step ' + (i + 1) + ' "' + c + '" is understood and does something (' + t.slice(0, 60) + ')');
	});
	finalState = st;
	ok(st.score === world.maxScore, 'full score reached (got ' + st.score + ' of ' + world.maxScore + ')');
	ok(st.ended === true && st.flags.complete, 'the chapter ends and sets the flag "complete"');
	ok(new RegExp('CHAPTER ' + n + ' COMPLETE').test(all[all.length - 1]), 'the last command prints "CHAPTER ' + n + ' COMPLETE"');
	ok(cmds.length >= 15 && cmds.length <= 60, 'the shortest playthrough is 15 to 60 commands (' + cmds.length + ')');
	console.log('  ' + cmds.length + ' commands, score ' + st.score + '/' + world.maxScore + ', ' + st.moves + ' moves');
})();

/* spice */
(function () {
	var res = {};
	['off', 'mild', 'medium', 'hot'].forEach(function (lvl) {
		var eng = new Engine(world, { spice: lvl }), st = eng.newState(carry), text = '';
		cmds.forEach(function (c) { var r = eng.exec(st, c); st = r.state; text += ' ' + plain(r).join(' '); });
		res[lvl] = text; ok(st.score === world.maxScore, lvl + ': same score and puzzles');
	});
	ok(res.off !== res.mild, 'mild has at least one wink that off does not');
	ok(JSON.stringify(world).indexOf('"s":"medium"') !== -1 || JSON.stringify(world).indexOf('"s": "medium"') !== -1, 'has at least one medium line');
	ok(res.off.length <= res.mild.length && res.mild.length <= res.medium.length, 'each level adds text and never removes it');
})();

/* hints */
(function () {
	var eng = new Engine(world), st = eng.newState(carry), seen = {}, stages = 0;
	var h = [1, 2, 3].map(function () { var r = eng.exec(st, 'hint'); st = r.state; return plain(r).join(' '); });
	ok(h[0] !== h[1] && h[1] !== h[2], 'hints escalate');
	var e2 = new Engine(world), s2 = e2.newState(carry);
	cmds.forEach(function (c) {
		var r = e2.exec(s2, 'hint'), t = plain(r).join(' ');
		if (t.length > 5 && !seen[t]) { seen[t] = 1; stages++; }
		s2 = e2.exec(r.state, c).state;
	});
	ok(stages >= 4, 'distinct hints appear through the walkthrough (' + stages + ')');
})();

/* purity */
(function () {
	var eng = new Engine(world), st = eng.newState(carry);
	cmds.forEach(function (c) { var b = JSON.stringify(st), r = eng.exec(st, c); ok(JSON.stringify(st) === b, 'exec("' + c + '") left the old state untouched'); st = r.state; });
})();

/* dead ends */
function explore(w) {
	var eng = new Engine(w), hit = {}, orig = eng.runRule;
	eng.runRule = function (st, rule, out) { hit[rule.id] = 1; return orig.call(eng, st, rule, out); };
	var start = eng.newState(carry), index = {}, states = [start], edges = [[]], queue = [0];
	index[eng.hash(start)] = 0;
	while (queue.length) {
		var i = queue.shift(), st = states[i];
		eng.candidates(st).forEach(function (c) {
			var nx = eng.exec(st, c).state, h = eng.hash(nx);
			if (h === eng.hash(st)) { return; }
			if (index[h] === undefined) { index[h] = states.length; states.push(nx); edges.push([]); queue.push(index[h]); }
			edges[i].push(index[h]);
		});
		if (states.length > 300000) { throw new Error('state space is unexpectedly large: simplify the chapter'); }
	}
	var back = states.map(function () { return []; });
	edges.forEach(function (o, i) { o.forEach(function (j) { back[j].push(i); }); });
	var good = {}, stack = [];
	states.forEach(function (s, i) { if (s.flags.complete) { good[i] = 1; stack.push(i); } });
	while (stack.length) { var k = stack.pop(); back[k].forEach(function (j) { if (!good[j]) { good[j] = 1; stack.push(j); } }); }
	return { states: states, hit: hit, dead: states.filter(function (s, i) { return !good[i]; }), any: states.some(function (s) { return s.flags.complete; }) };
}
(function () {
	var r = explore(world);
	console.log('  ' + r.states.length + ' reachable states searched');
	ok(r.any, 'a winning state is reachable');
	ok(r.dead.length === 0, r.dead.length + ' dead-end state(s)' + (r.dead[0] ? ' (e.g. room ' + r.dead[0].room + ', flags ' + Object.keys(r.dead[0].flags).join(',') + ')' : ''));
	world.rules.forEach(function (rule) { ok(r.hit[rule.id], 'rule "' + rule.id + '" can be triggered'); });
	ok(r.states.some(function (s) { return s.score === world.maxScore && s.ended; }), 'the full score is reachable');
	// negative control: delete the first scoring step's item and the search must find trouble
	var broken = JSON.parse(JSON.stringify(world)), victim = broken.rules.filter(function (x) { return JSON.stringify(x.effects).indexOf('"end"') !== -1; })[0];
	victim.requires = (victim.requires || []).concat([{ flag: 'impossible-flag' }]);
	var b = explore(broken);
	ok(!b.any && b.dead.length > 0, 'negative control: an unwinnable chapter is detected');
})();

console.log(failures ? failures + ' of ' + checks + ' checks FAILED' : 'chapter ' + n + ': all ' + checks + ' checks passed');
process.exit(failures ? 1 : 0);
