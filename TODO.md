# TEST / BUILD

- Move the game logic tests out of `games/` (e.g. to a top-level `tests/`) so
  `serve.mjs` doesn't expose `2048.test.mjs` / `icewall.test.mjs` publicly.
  Keep `games/` as the public root only.

