const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

async function fixture(t) {
  const base = await fs.mkdtemp(path.resolve(__dirname, '../../../work/test-artifacts-unit-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const work = path.join(base, 'work');
  await fs.mkdir(work);
  const api = await import('../scripts/test-artifacts.mjs');
  return { base, work, ...api };
}

test('successful runs remove their registered fresh profiles only', async t => {
  const { work, createTestArtifacts, recordTestProfile } = await fixture(t);
  const run = await createTestArtifacts(work);
  const own = await fs.mkdtemp(path.join(work, 'owned-'));
  const other = await fs.mkdtemp(path.join(work, 'unregistered-'));
  await fs.writeFile(path.join(own, 'cache'), 'generated');
  await recordTestProfile({ MOYU_TEST: '1', MOYU_USER_DATA: own }, run.ledger);
  assert.deepEqual(await run.finish(true), { removed: 1 });
  await assert.rejects(fs.stat(own), { code: 'ENOENT' });
  assert.ok((await fs.stat(other)).isDirectory());
});

test('failed runs preserve their profiles and ledger', async t => {
  const { work, createTestArtifacts, recordTestProfile } = await fixture(t);
  const run = await createTestArtifacts(work);
  const own = await fs.mkdtemp(path.join(work, 'owned-'));
  await recordTestProfile({ MOYU_TEST: '1', MOYU_USER_DATA: own }, run.ledger);
  assert.ok((await run.finish(false)).retained);
  assert.ok((await fs.stat(own)).isDirectory());
  assert.ok((await fs.stat(run.ledger)).isFile());
});

test('existing profiles, outside paths and junction targets are protected', async t => {
  const { base, work, createTestArtifacts, recordTestProfile } = await fixture(t);
  const existing = await fs.mkdtemp(path.join(work, 'existing-'));
  await new Promise(resolve => setTimeout(resolve, 30));
  const run = await createTestArtifacts(work);
  const outside = path.join(base, 'outside');
  const link = path.join(work, 'link');
  await fs.mkdir(outside);
  await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  for (const directory of [existing, outside, link, work]) {
    await recordTestProfile({ MOYU_TEST: '1', MOYU_USER_DATA: directory }, run.ledger);
  }
  assert.deepEqual(await run.finish(true), { removed: 0 });
  for (const directory of [existing, outside, link]) assert.ok(await fs.lstat(directory));
});

test('a live recorded process prevents cleanup', async t => {
  const { work, createTestArtifacts, recordTestProfile, recordTestProcess } = await fixture(t);
  const run = await createTestArtifacts(work);
  const own = await fs.mkdtemp(path.join(work, 'owned-'));
  await recordTestProfile({ MOYU_TEST: '1', MOYU_USER_DATA: own }, run.ledger);
  await recordTestProcess(process.pid, run.ledger);
  assert.ok((await run.finish(true)).retained);
  assert.ok(await fs.stat(own));
});

test('normal application profiles are never registered', async t => {
  const { work, createTestArtifacts, recordTestProfile } = await fixture(t);
  const run = await createTestArtifacts(work);
  const own = await fs.mkdtemp(path.join(work, 'normal-'));
  await recordTestProfile({ MOYU_USER_DATA: own }, run.ledger);
  assert.deepEqual(await run.finish(true), { removed: 0 });
  assert.ok(await fs.stat(own));
});
