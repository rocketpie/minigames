# TEST / BUILD

- Move the game logic tests out of `games/` (e.g. to a top-level `tests/`) so
  `serve.mjs` doesn't expose `2048.test.mjs` / `icewall.test.mjs` publicly.
  Keep `games/` as the public root only.

# Dreizehn
- cards can only move up.
  per turn, a player can only put one hand card on each personal stash. from the stash, cards cannot go back to the hand, only to the shared 'goal' stacks.
- i want to see my stack, from where i pull cards, next to my caches. here, only the top card is visible.
  I can play that card as if it were on my hand: put it on any of my caches, or put it on any of the shared stacks. when it's played, the next card is revealed.
- reduce the size of my stack from a full set to 15 cards. all remaining cards go onto a shared 'draw' stack.
- when drawing onto my hand, do not draw from my stack. draw cards from a shared 'draw' stack.
  it's replenished when a stack in the middle is full (13 cards). these are then shuffeled into the shared 'draw' stack. 
- game goal remains emptying my stack and all my caches.