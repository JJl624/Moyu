const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const beforeBuild = require('../scripts/before-build.cjs');

test('builder accepts externally staged dependencies and refuses missing runtime files', async t => {
  const appDir = await fs.mkdtemp(path.resolve(__dirname, '../../../work/build-staging-unit-'));
  t.after(() => fs.rm(appDir, { recursive: true, force: true }));
  for (const name of ['electron/main.cjs', 'node_modules/esbuild/package.json', 'node_modules/esbuild/lib/main.js', 'resources/tools/'+require('../shared/native-esbuild.cjs').esbuildName()]) {
    await assert.rejects(beforeBuild({ appDir }), /Missing staged runtime file/);
    await fs.mkdir(path.dirname(path.join(appDir, name)), { recursive: true });
    await fs.writeFile(path.join(appDir, name), 'fixture');
  }
  assert.equal(await beforeBuild({ appDir }), false);
});
