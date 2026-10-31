import test from 'node:test';
import assert from 'node:assert/strict';
import { safeReturn } from './public/return-url.js';

test('only allowed game origins are accepted as return urls', () => {
  assert.equal(
    safeReturn('https://co3d.eu/dreiziehn/dreiziehn.html'),
    'https://co3d.eu/dreiziehn/dreiziehn.html',
  );
  assert.equal(
    safeReturn('http://localhost:8000/dreiziehn/dreiziehn.html'),
    'http://localhost:8000/dreiziehn/dreiziehn.html',
  );
  assert.equal(safeReturn('https://evil.example/game.html'), '');
  assert.equal(safeReturn('javascript:alert(1)'), '');
  assert.equal(safeReturn('https://user:pass@co3d.eu/game.html'), '');
  assert.equal(safeReturn(''), '');
});
