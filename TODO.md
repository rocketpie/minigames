# TEST / BUILD

- Move the game logic tests out of `games/` (e.g. to a top-level `tests/`) so
  `serve.mjs` doesn't expose `2048.test.mjs` / `icewall.test.mjs` publicly.
  Keep `games/` as the public root only.

# Dreizehn
- support player disconnect (host should be able to click on a player and disconnect)
- i want to be able to see the two cards below the top in the middle, and up to 5 on my own stacks.
- I want to change the cards. instead of A to K, i want to just number them 1 - 13. color them by the number value, range from blue (1) to red (13).