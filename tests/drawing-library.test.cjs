const { test } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { Vault } = require('../electron/vault.cjs'), { DrawingLibrary, parseLibrary, readLibraryFile } = require('../electron/drawing-library.cjs');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moyu-library-')), vault = await new Vault(root).init();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, vault, library: new DrawingLibrary(vault) };
}
const item = { id: 'example', status: 'unpublished', created: 123, elements: [{ id: 'rectangle', type: 'rectangle' }] };
test('A workspace library persists in a visible standard file, survives restart and avoids unchanged writes', async t => {
  const { root, vault, library } = await fixture(t);
  assert.deepEqual(await library.read(), { root, libraryItems: [] });
  const file = path.join(root, '.data/excalidraw_library.excalidrawlib');
  assert.equal(await fs.stat(file).catch(() => null), null);
  await library.save([item]);
  const time = (await fs.stat(file)).mtimeMs;
  await library.save([item]); assert.equal((await fs.stat(file)).mtimeMs, time);
  assert.deepEqual(await new DrawingLibrary(vault).read(), { root, libraryItems: [item] });
  assert.equal(parseLibrary(await readLibraryFile(file)).version, 2);
  assert.equal(parseLibrary('\uFEFF' + await fs.readFile(file, 'utf8')).version, 2);
  await library.save([]); assert.deepEqual((await library.read()).libraryItems, []);
});
test('Libraries remain independent across knowledgebases and invalid imports cannot overwrite saved items', async t => {
  const one = await fixture(t), two = await fixture(t);
  await one.library.save([item]); assert.deepEqual((await two.library.read()).libraryItems, []);
  await assert.rejects(one.library.save([{ elements: [null] }]), /格式无效/);
  assert.deepEqual((await one.library.read()).libraryItems, [item]);
  for (const content of ['null', '{}', '{', JSON.stringify({ type: 'excalidrawlib', version: 2, libraryItems: [item, {elements: 'wrong'}] })]) assert.throws(() => parseLibrary(content), /格式无效/);
  assert.equal(parseLibrary(JSON.stringify({ type: 'excalidrawlib', version: 1, library: [item.elements] })).version, 1);
  assert.throws(() => parseLibrary(JSON.stringify({ type: 'excalidrawlib', version: 2, library: [item.elements] })), /格式无效/);
});
test('Corrupted and oversized library files fail with a clear error', async t => {
  const { root, library } = await fixture(t); await library.save([item]);
  const file = path.join(root, '.data/excalidraw_library.excalidrawlib');
  await fs.writeFile(file, 'null'); await assert.rejects(library.read(), /格式无效/);
  const handle = await fs.open(file, 'w'); await handle.truncate(20 * 1024 * 1024 + 1); await handle.close();
  await assert.rejects(library.read(), /超过 20 MB/); await assert.rejects(readLibraryFile(file), /超过 20 MB/);
});
