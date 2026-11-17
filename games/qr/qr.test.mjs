// URL guard for qr.html: `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('./qr.html', import.meta.url), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
const el = () => ({
  textContent: '', hidden: false, href: '',
  classList: { add() {}, remove() {} },
  addEventListener() {},
});
const ctx = {
  document: { getElementById: el, createElement: el },
  addEventListener() {}, setTimeout() {}, URL, navigator: {},
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

const safeUrl = text => vm.runInContext(`safeUrl(${JSON.stringify(text)})`, ctx);

test('only http(s) codes become links', () => {
  assert.equal(safeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeUrl('HTTP://example.com'), 'http://example.com/');
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('data:text/html,hi'), null);
  assert.equal(safeUrl('Wi-Fi: S:home'), null);
  assert.equal(safeUrl(''), null);
});

test('decode downscales a large photo before handing it to jsQR', () => {
  const seen = {};
  ctx.jsQR = (data, w, h) => { seen.w = w; seen.h = h; return { data: 'hello' }; };
  ctx.document.createElement = () => ({
    width: 0, height: 0,
    getContext: () => ({
      drawImage(source, x, y, w, h) { seen.drawn = [w, h]; },
      getImageData() { return { data: [] }; },
    }),
  });
  assert.equal(vm.runInContext('decode({}, 1000, 500, 800)', ctx), 'hello');
  assert.deepEqual(seen.drawn, [800, 400]);
  assert.deepEqual([seen.w, seen.h], [800, 400]);
});
