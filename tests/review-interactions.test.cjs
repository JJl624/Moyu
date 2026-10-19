const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path'), Module = require('node:module');
const compiled = require('esbuild').buildSync({ entryPoints: [path.resolve(__dirname, '../src/keyboardComposition.ts')], bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text;
const mod = new Module(__filename, module);
mod._compile(compiled, __filename);

test('Composition keys support native events, React wrappers and legacy IME key codes', () => {
  const { isComposingKey } = mod.exports;
  assert.equal(isComposingKey({ isComposing: true }), true);
  assert.equal(isComposingKey({ keyCode: 229 }), true);
  assert.equal(isComposingKey({ nativeEvent: { isComposing: true } }), true);
  assert.equal(isComposingKey({ nativeEvent: { keyCode: 229 } }), true);
  assert.equal(isComposingKey({ isComposing: false, keyCode: 27 }), false);
});

test('Search line locations retain UTF-16 and CRLF offsets and bound invalid lines', async () => {
  const { lineOffset } = await import('../shared/search-location.mjs');
  const text = '甲😀\r\nsecond\n\nlast';
  assert.equal(lineOffset(text, 1), 0);
  assert.equal(lineOffset(text, 2), 5);
  assert.equal(lineOffset(text, 3), 12);
  assert.equal(lineOffset(text, 4), 13);
  assert.equal(lineOffset(text, 100), text.length);
  assert.equal(lineOffset(text, NaN), 0);
  assert.equal(lineOffset(text, -1), 0);
  assert.equal(lineOffset('', 2), 0);
});
