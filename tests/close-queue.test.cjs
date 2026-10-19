const test = require('node:test'), assert = require('node:assert/strict');
const { buildSync } = require('esbuild'), Module = require('node:module'), path = require('node:path');
const source = buildSync({ entryPoints: [path.resolve(__dirname, '../src/documents/closeQueue.ts')], bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text;
const loaded = new Module(__filename, module); loaded.paths = module.paths; loaded._compile(source, __filename);
const { createCloseQueue } = loaded.exports;
test('A pending close cannot authorize a different document or whole-window close', async () => {
  const queue = createCloseQueue(), calls = []; let release;
  const first = queue(async () => { calls.push('A'); return new Promise(resolve => { release = resolve; }); });
  const second = queue(async () => { calls.push('B'); return false; });
  const window = queue(async () => { calls.push('window'); return true; });
  await Promise.resolve(); assert.deepEqual(calls, ['A']);
  release(true); assert.equal(await first, true); assert.equal(await second, false); assert.equal(await window, true);
  assert.deepEqual(calls, ['A', 'B', 'window']);
});
test('A failed request leaves subsequent document saves usable', async () => {
  const queue = createCloseQueue();
  await assert.rejects(queue(async () => { throw Error('save failed'); }), /save failed/);
  assert.equal(await queue(async () => true), true);
});
