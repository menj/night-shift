#!/usr/bin/env node
/* Writes data/chapters.json from data/ch<N>.json + tests/ch<N>.txt (stops at the first missing chapter).
   The page reads it to know the chapters; the server reads it for the leaderboard's score and move bounds.
   Run after adding or changing a chapter:  node tools/build-index.js */
'use strict';
var fs = require('fs'), path = require('path'), root = path.join(__dirname, '..'), out = [];
for (var n = 1; fs.existsSync(path.join(root, 'data/ch' + n + '.json')); n++) {
	var w = JSON.parse(fs.readFileSync(path.join(root, 'data/ch' + n + '.json'), 'utf8'));
	var cmds = fs.readFileSync(path.join(root, 'tests/ch' + n + '.txt'), 'utf8').split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l && l[0] !== '#'; });
	out.push({ n: n, title: String(w.chapter).replace(/^Chapter \d+:\s*/, ''), file: 'data/ch' + n + '.json', maxScore: w.maxScore, minMoves: cmds.length });
}
fs.writeFileSync(path.join(root, 'data/chapters.json'), JSON.stringify({ chapters: out }, null, 2) + '\n');
console.log(out.length + ' chapters: ' + out.map(function (c) { return c.n + ' ' + c.title + ' (' + c.maxScore + ' pts, ' + c.minMoves + ' moves)'; }).join('; '));
