const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  os = require('node:os'),
  path = require('node:path');
const { Vault } = require('../electron/vault.cjs');
const { binaryRead } = require('../electron/file-viewers.cjs');
test('all CM text filenames use safe UTF-8 reads and conflict-aware saves; BOM/CRLF survive', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moyu-files-')), vault = await new Vault(root).init();
  try {
    for (
      const name of [
        'test.cpp',
        'script.py',
        'notes.lua',
        'query.sql',
        'settings.xml',
        'Dockerfile',
        'Makefile',
        'test.rs',
        'test.go',
        'unknown.xyz',
      ]
    ) {
      await fs.writeFile(path.join(root, name), '\ufeff中文\r\nsecond\r\n');
      const d = await vault.read(name);
      assert.equal(d.content, '\ufeff中文\r\nsecond\r\n');
      await vault.save(name, d.content + 'more\r\n', d.version);
      assert.equal(await fs.readFile(path.join(root, name), 'utf8'), d.content + 'more\r\n');
      await assert.rejects(vault.save(name, 'old', d.version), e => e.code === 'CONFLICT');
    }
    await fs.writeFile(path.join(root, 'binary.exe'), Buffer.from([0, 1, 2]));
    await assert.rejects(vault.read('binary.exe'), /二进制/);
    await fs.writeFile(path.join(root, 'bad.txt'), Buffer.from([255, 255]));
    await assert.rejects(vault.read('bad.txt'), /UTF-8/);
    await assert.rejects(vault.save('test.pdf', 'wrong', ''), /无效/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('native images and binary viewers share final-extension classification and bounded snapshots', async () => {
  const { fileKind } = await import('../shared/file-kind.mjs');
  for (
    const extension of [
      'png',
      'apng',
      'jpg',
      'jpeg',
      'jfif',
      'pjpeg',
      'pjp',
      'gif',
      'webp',
      'avif',
      'svg',
      'bmp',
      'ico',
      'cur',
    ]
  ) assert.equal(fileKind('图.excalidraw.' + extension), 'image');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moyu-binary-')), vault = await new Vault(root).init();
  try {
    await fs.writeFile(path.join(root, 'bad.db'), 'wrong');
    await assert.rejects(binaryRead(vault, 'bad.db', true), /SQLite/);
    await fs.writeFile(path.join(root,'pending.db'),'SQLite format 3\0');
    await fs.writeFile(path.join(root,'pending.db-wal'),Buffer.alloc(64));
    await assert.rejects(binaryRead(vault,'pending.db',true),/WAL/);
    await fs.writeFile(path.join(root, 'large.pdf'), '');
    const f = await fs.open(path.join(root, 'large.pdf'), 'r+');
    await f.truncate(129 * 1024 * 1024);
    await f.close();
    await assert.rejects(binaryRead(vault, 'large.pdf'), /128 MB/);
    await assert.rejects(binaryRead(vault, '../outside.pdf'), /路径/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('SQLite catalog includes objects and metadata; pagination is bounded and all writes stay forbidden', async () => {
  const SQL = await require('sql.js')(),
    db = new SQL.Database(),
    { sqliteBrowser, objectQuery } = await import('../shared/sqlite-browser.mjs');
  try {
    db.run(
      `CREATE TABLE items(id INTEGER PRIMARY KEY,name); CREATE VIEW item_view AS SELECT * FROM items; CREATE INDEX item_idx ON items(name); CREATE TRIGGER item_trigger AFTER INSERT ON items BEGIN SELECT 1; END; CREATE VIRTUAL TABLE search USING fts3(content); PRAGMA user_version=42;`,
    );
    db.run(
      `WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<205) INSERT INTO items SELECT x,'item-'||x FROM n;`,
    );
    const viewer = sqliteBrowser(db), catalog = viewer.catalog();
    for (const type of ['table', 'view', 'index', 'trigger', 'virtual', 'shadow']) {
      assert.ok(catalog.objects.some(o => o.type === type), type);
    }
    assert.equal(catalog.metadata.user_version, 42);
    assert.ok(catalog.objects.some(o => o.name === 'sqlite_schema'));
    assert.equal(viewer.query('SELECT * FROM items').rows.length, 100);
    assert.equal(viewer.query('SELECT * FROM items', 1).rows[0][0], '101');
    assert.equal(viewer.query('SELECT * FROM items', 2).rows.length, 5);
    assert.equal(viewer.query("SELECT zeroblob(100000),printf('%.*c',5000,'a')").rows[0][1].length, 4096);
    assert.equal(viewer.query(objectQuery({ type: 'table', name: 'items' })).columns[0], 'id');
    for (
      const sql of [
        'DELETE FROM items',
        'PRAGMA query_only=OFF',
        'PRAGMA user_version=2',
        "ATTACH ':memory:' AS test",
        'SELECT 1; DELETE FROM items',
        'WITH n AS (SELECT 1) DELETE FROM items',
        "VACUUM INTO 'test.db'",
      ]
    ) assert.throws(() => viewer.query(sql), /只读|readonly/);
    assert.equal(viewer.query('SELECT COUNT(*) FROM items').rows[0][0], '205');
    assert.equal(viewer.query('PRAGMA user_version').rows[0][0], '42');
  } finally {
    db.close();
  }
});
