# Night Shift: design bible

Five chapters, one night. Each chapter is a self-contained world file `data/ch<N>.json` plus its shortest playthrough `tests/ch<N>.txt`. `node tools/check-chapter.js <N>` must pass before a chapter ships.

## Premise

You are the new night attendant at the Pixel Palace Arcade: overconfident, underqualified, certain this job is step one of a legend. Tonight the Glitch is unplugging the machines one by one. You are the only attendant left.

**Voice: Larry Laffer meets Guybrush Threepwood.** Larry: a hopeless, hopeful romantic who flirts with more optimism than skill; the innuendo is the joke and the Attendant is always the butt of it. Guybrush: sincere, bumbling, brave, proud of terrible plans; sensible nonsense puzzles; trades insults with machines. Sierra and LucasArts humour: every silly attempt gets a funny reply, nothing is fatal, nobody is ever truly humiliated beyond a smile.

## The five chapters

1. **Dead Air** (the arcade): tutorial. Lobby, snack bar, floor, prize counter, back office, disco. Rescue Moe, fix the mixer, win over Mira. Done.
2. **Flap Zone** (inside the Beberd cabinet): Hamilton stars. Pipes are untrustworthy, gravity is a suggestion. Hamilton must learn to fly with the Attendant as coach. Sets `carry:ch2`.
3. **Dune Run** (inside the Pixel Run cabinet): the desert at dawn, noon and night. Eeny, Meeny and Miny each have a skill; Moe rides along. Obstacles are cacti and birds. Sets `carry:ch3`.
4. **Cable Maze** (the machine room under the arcade): the Glitch's tendrils, a tangle of cables to untangle in the right order, Mira helps over the radio. Sets `carry:ch4`.
5. **Last Credit** (the Power Room): the Big Bad. Everyone combines, Avengers-Endgame style, each hero doing the thing they learned. Needs `carry:ch1` to `carry:ch4`. Ends the story.

The Big Bad is **the Glitch**: a hungry little corruption that wants the arcade quiet. It is not evil, it is lonely and bored, and it unplugs things because nobody ever plays the old machines. The finale is a rescue as much as a fight: win by giving it something to play.

## Cast

- **The Attendant** (you): never described beyond a tragic jacket, a name badge that says TRAINEE, and unearned confidence.
- **Hamilton**: a small, round, very serious bird. Questionable aerodynamics, unquestionable confidence. Distrusts pipes.
- **Eeny** (dino), **Meeny** (cat), **Miny** (penguin), **Moe** (small blue robot who SHOUTS IN CAPITALS): the Pixel Run runners. Eeny is brave and dim, Meeny is vain and quick, Miny is calm and deadpan, Moe knows machines.
- **Mira Bell**: the glamorous, unimpressed disco DJ. Dry, warm underneath, impossible to impress, and keeps being a little impressed. Original character.

## Spice

A layer, never a gate. Text can be tagged `{"s":"mild","t":"..."}` or `{"s":"medium","t":"..."}`. Off shows neither; Mild shows mild; Medium shows both; Hot also unlocks the gallery card (the card event fires at every level). Mild: a wink, a double meaning. Medium: flirty, a fade to black. **Never explicit, never nudity, never a real person.** The puzzles and the score are identical at every level. Titles and metadata stay clean.

## Design rules

No dead ends (machine-checked). No sudden death. Clue before puzzle. No guess-the-verb: every action is a button or a tappable word. Introduce, vary, twist: teach a mechanic safely, use it again with a change, then subvert it. Offer a second solution where it is cheap. Every plausible silly attempt gets a funny answer, not "nothing happens". A hint ladder for every stage. Fair puzzles: the world tells you what it wants before it asks.

## Authoring format

Read `data/ch1.json` (the model chapter), `js/engine.js` (the semantics) and `tools/check-chapter.js` (the rules). Fields: `title`, `chapter`, `start`, `maxScore` (3 to 6), `carry` (flags assumed at start), `intro`, `help`, `rooms`, `items` (things and scenery, `loc`, `aliases`, `desc`, `takeable`, `read`, `points`), `npcs` (`loc`, `here`, `desc`, `talk`, `topics`), `rules` (verb/noun/with, `requires`, `else`, `effects`: say, scene, flag, unflag, score, move, give, unlock, open, follow, card, secret, end), `hints` (stages with `done` conditions and escalating `lines`), `glitch` (fallback lines), `cards`. `scene` is a list of beats shown one at a time (Continue / Skip) with an optional `still` image (see `img/scenes/`). `cards` maps a card id to `title`, `who`, `secretHint` and, for a bonus card, `with` (the parent card whose secret also opens it). `secret` names the gallery card a rule fully reveals; by convention such a rule has a `skipIf` on its own flag so it fires once, and it never scores or ends the chapter. The chapter's `carry` list declares the flags assumed at its start; its ending rule sets `carry:ch<N>` for the next chapter. Descriptions mark tappable words as `[[id|text]]`. The ending rule sets `complete` and `carry:ch<N>`, awards the last point, fires a `card`, says "CHAPTER <N> COMPLETE: <TITLE>." then a teaser for the next chapter, and ends.
