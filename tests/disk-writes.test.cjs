const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  path = require('node:path');
const { DataStore } = require('../electron/data.cjs'),
  { RuntimeSettings } = require('../electron/runtime-settings.cjs'),
  { atomicIfChanged } = require('../electron/files.cjs');
const { Vault } = require('../electron/vault.cjs'),
  { Attachments } = require('../electron/attachments.cjs');
const base = path.resolve(__dirname, '../../../work/disk-write-tests');
async function fixture() {
  await fs.mkdir(base, { recursive: true });
  return fs.mkdtemp(path.join(base, 'case-'));
}

test('Unchanged settings create no temporary files or writes; a preference batch writes once', async () => {
  const root = await fixture(),
    store = new DataStore(root),
    settings = new RuntimeSettings(root),
    file = path.join(root, 'settings.json');
  await store.setMany({ values: { 'moyu-theme': 'light', 'moyu-font': 'Arial' } });
  await settings.configure('javascript', { executionTimeoutSeconds: 10 });
  const write = fs.writeFile;
  let count = 0;
  fs.writeFile = async function(target, ...args) {
    if (String(target).startsWith(root + path.sep)) count++;
    return write.call(this, target, ...args);
  };
  try {
    for (let i = 0; i < 25; i++) {
      await store.set({ key: 'moyu-theme', value: 'light' });
      await settings.configure('javascript', { executionTimeoutSeconds: 10 });
      assert.equal(await atomicIfChanged(file, await fs.readFile(file)), false);
    }
    assert.equal(count, 0);
    await store.setMany({
      values: { 'moyu-theme': 'dark', 'moyu-font': 'Consolas', 'moyu-fontsize': '16' },
    });
    assert.equal(count, 1);
    assert.equal((await store.get())['moyu-font'], 'Consolas');
    await assert.rejects(async () => store.setMany({ values: { other: 'unsafe' } }), /设置格式/);
  } finally {
    fs.writeFile = write;
  }
});

test('Changing code or language keeps identity metadata byte-identical and does not write it', async () => {
  const root = await fixture(),
    vault = await new Vault(root).init(),
    documents = new Attachments(vault).documents;
  let doc = await vault.create('代码.md', 'file', '```py {id=0001}\nprint(1)\n```');
  await documents.sync(doc.path, doc.content);
  await vault.mutate(() => documents.ensureUnlocked(doc.path));
  const files = ['.data/document_map.json', '代码.assets/document.json'];
  const before = await Promise.all(files.map(name => fs.readFile(path.join(root, name), 'utf8')));
  for (const body of before) {
    assert.doesNotMatch(body, /language|Python|py|active|hash/);
    assert.deepEqual(JSON.parse(body).blocks || JSON.parse(body).documents[doc.path].blocks, [
      '0001',
    ]);
  }
  for (const language of ['js', 'sql', 'text', 'cpp']) {
    doc = await vault.save(doc.path, `\`\`\`${language} {id=0001}\nchanged\n\`\`\``, doc.version);
    const write = fs.writeFile;
    let writes = 0;
    fs.writeFile = async function(...args) {
      writes++;
      return write.apply(this, args);
    };
    try {
      for (let i = 0; i < 3; i++) await documents.sync(doc.path, doc.content);
      assert.equal(writes, 0);
    } finally {
      fs.writeFile = write;
    }
    assert.deepEqual(
      await Promise.all(files.map(name => fs.readFile(path.join(root, name), 'utf8'))),
      before,
    );
  }
});
