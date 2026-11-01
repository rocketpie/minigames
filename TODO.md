# TEST / BUILD

- Move the game logic tests out of `games/` (e.g. to a top-level `tests/`) so
  `serve.mjs` doesn't expose `2048.test.mjs` / `icewall.test.mjs` publicly.
  Keep `games/` as the public root only.

# neues Spiel 'Beweg'
- Schach, aber mit einer neuen Figur.
  sie ersetzt die äußeren Bauern. Sie kann in einem Zug sich selbst auf ein beliebiges Feld teleportieren.
  teleportiert sie auf eine gegnerische figur, explodiert diese. Nur der gegnerische König und die Dame können nicht mit ihr angegriffen werden.
  beim angriff stirbt die Figur selbst.
  Sie soll aussehen wie die Dame, nur ohne Krone.