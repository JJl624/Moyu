const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path');
const { SyncState } = require('../electron/sync-state.cjs');
const base = path.resolve(__dirname, '../../../work/sync-state-tests'),
  version = 'a'.repeat(64),
  next = 'b'.repeat(64);
async function fixture() {
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, 'case-'));
  return new SyncState(path.join(root, 'state.json'));
}
test('A large baseline is written once; successful steps only append small records', async () => {
  const p = await fixture(), state = await p.read();
  for (let i = 0; i < 10000; i++) state.base['笔记-' + i + '.md'] = version;
  await p.compact(state);
  const before = (await fs.stat(p.file)).mtimeMs, bytes = await fs.readFile(p.file);
  for (let i = 0; i < 80; i++) {
    state.base['笔记-' + i + '.md'] = next;
    await p.record(state, '笔记-' + i + '.md', next);
  }
  assert.equal((await fs.stat(p.file)).mtimeMs, before);
  assert.deepEqual(await fs.readFile(p.file), bytes);
  assert((await fs.stat(p.journal)).size < 20000);
  assert.equal((await new SyncState(p.file).read()).base['笔记-79.md'], next);
  await p.compact(state);
  assert.equal(await fs.stat(p.journal).catch(() => null), null);
  assert.equal(JSON.parse(await fs.readFile(p.file)).base['笔记-79.md'], next);
});
test('Restart replays completed records, discards a torn tail, and ignores pre-checkpoint records after a crash', async () => {
  const p = await fixture(), state = await p.read();
  state.base['a.md'] = version;
  await p.compact(state);
  state.base['a.md'] = next;
  await p.record(state, 'a.md', next);
  await fs.appendFile(p.journal, '{"revision":1,"path":');
  const restored = await new SyncState(p.file).read();
  assert.equal(restored.base['a.md'], next);
  const old = JSON.stringify({ revision: restored.revision, path: 'a.md', version }) + '\n';
  await p.compact(restored);
  await fs.writeFile(p.journal, old);
  assert.equal((await new SyncState(p.file).read()).base['a.md'], next);
  await p.compact(await p.read());
  assert.equal(await fs.stat(p.journal).catch(() => null), null);
});
test('Status reads never write and journal entries cannot reference external or internal data paths', async () => {
  const p = await fixture(), state = await p.read();
  await p.compact(state);
  const before = (await fs.stat(p.file)).mtimeMs;
  for (let i = 0; i < 20; i++) await p.read();
  assert.equal((await fs.stat(p.file)).mtimeMs, before);
  for (const name of ['../host', '/host', '.data/private', 'foo/../host']) {
    await assert.rejects(p.record(state, name, version), /同步步骤/);
  }
  await assert.rejects(p.record(state, 'note.md', 'bad'), /同步步骤/);
  assert.equal(await fs.stat(p.journal).catch(() => null), null);
});
