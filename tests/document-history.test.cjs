const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { Vault } = require("../electron/vault.cjs"),
  { DocumentHistory, INTERVAL, MAX_TEXT, MAX_STORE } = require("../electron/document-history.cjs");
const {DatabaseSync}=require("node:sqlite");
function historySize(file,document){const db=new DatabaseSync(file,{readOnly:true});try{return db.prepare("SELECT sum(length(data)+128) AS size FROM history WHERE document=?").get(document).size;}finally{db.close();}}
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moyu-history-")), vault = await new Vault(root).init();
  let now = 1700000000000;
  const history = vault.history = new DocumentHistory(vault, { clock: () => now });
  return { root, vault, history, advance: value => now += value };
}
test("History preserves the original text, checkpoints at intervals, and leaves idle and repeated saves without history writes", async () => {
  const f = await fixture();
  assert.deepEqual((await f.history.list("文档.md")).entries, []);
  assert.equal(await fs.stat(path.join(f.root, ".data/history")).catch(() => null), null);
  let doc = await f.vault.create("文档.md", "file", "\ufeff# 原文\r\n中文\r\n");
  doc = await f.vault.save(doc.path, "# 第一版\n", doc.version);
  const first = await f.history.list(doc.path);
  assert.equal(first.entries.length, 2);
  assert.equal((await f.history.read(doc.path, first.entries[1].id)).content, "\ufeff# 原文\r\n中文\r\n");
  const recordFile = f.history.database.file,
    before = await fs.readFile(recordFile);
  const loader = f.history.load;
  let reads = 0;
  f.history.load = async (...args) => {
    reads++;
    return loader.apply(f.history, args);
  };
  for (let i = 0; i < 8; i++) {
    f.advance(100);
    doc = await f.vault.save(doc.path, "草稿" + i, doc.version);
  }
  assert.equal(reads, 0);
  assert.deepEqual(await fs.readFile(recordFile), before);
  f.advance(INTERVAL);
  doc = await f.vault.save(doc.path, "# 第二版\n", doc.version);
  assert.equal((await f.history.list(doc.path)).entries.length, 3);
  const stable = (await fs.stat(recordFile)).mtimeMs;
  await f.vault.save(doc.path, doc.content, doc.version);
  assert.equal((await fs.stat(recordFile)).mtimeMs, stable);
  f.vault.history = new DocumentHistory(f.vault, { clock: () => 1700000000000 + INTERVAL + 800 });
  assert.equal((await f.vault.history.list(doc.path)).entries.length, 3);
});
test("Restore preserves unsaved current content first and refuses conflicts, missing versions and unsafe requests", async () => {
  const f = await fixture();
  let doc = await f.vault.create("note.md", "file", "original");
  doc = await f.vault.save(doc.path, "saved", doc.version);
  const list = await f.history.list(doc.path), id = list.entries[1].id;
  const selected = await f.history.prepareRestore({
    document: doc.path,
    id,
    content: "unsaved current",
    version: doc.version,
  });
  assert.equal(selected.content, "original");
  assert.equal((await f.vault.read(doc.path)).content, "saved");
  const backup = (await f.history.list(doc.path)).entries[0];
  assert.equal(backup.reason, "restore");
  assert.equal((await f.history.read(doc.path, backup.id)).content, "unsaved current");
  await assert.rejects(
    f.history.prepareRestore({ document: doc.path, id, content: "x", version: "wrong" }),
    /外部修改/,
  );
  await assert.rejects(
    f.history.prepareRestore({ document: doc.path, id: "missing", content: "x", version: doc.version }),
    /不存在/,
  );
  for (const document of ["../escape.md", ".data/history/note.md/versions.json", "a/../b.md", "image.png"]) {
    await assert.rejects(f.history.list(document));
  }
  await assert.rejects(
    f.history.prepareRestore({ document: doc.path, id, content: "x".repeat(MAX_TEXT + 1), version: doc.version }),
    /上限/,
  );
  f.vault.recoveryError = "readonly";
  await assert.rejects(
    f.history.prepareRestore({ document: doc.path, id, content: "x", version: doc.version }),
    /readonly/,
  );
});
test("History has bounded retention; expired reads do not write and archive failures do not lose successful saves", async () => {
  const f = await fixture();
  let doc = await f.vault.create("note.md", "file", "original");
  for (let i = 0; i < 55; i++) {
    f.advance(INTERVAL);
    doc = await f.vault.save(doc.path, "version " + i, doc.version);
  }
  assert.equal((await f.history.list(doc.path)).entries.length, 50);
  const recordFile = f.history.database.file;
  assert(historySize(recordFile,doc.path)<=MAX_STORE);
  const bytes = await fs.readFile(recordFile);
  f.advance(31 * 86400000);
  assert.equal((await f.history.list(doc.path)).entries.length, 0);
  assert.deepEqual(await fs.readFile(recordFile), bytes);
  doc = await f.vault.save(doc.path, "after expiration", doc.version);
  assert.equal((await f.history.list(doc.path)).entries.length, 2);
  await fs.writeFile(recordFile, "{\"broken\":true}");
  f.advance(INTERVAL);
  const saved = await f.vault.save(doc.path, "still saved", doc.version);
  assert.equal(saved.content, "still saved");
  assert.match(saved.historyWarning, /文档已保存/);
  assert.equal((await f.vault.read(doc.path)).content, "still saved");
});
test("Application rename and folder moves carry history; copying starts fresh and deleting a document removes its history", async () => {
  const f = await fixture(),
    { Attachments } = require("../electron/attachments.cjs"),
    { References } = require("../electron/references.cjs"),
    { DocumentFiles } = require("../electron/document-files.cjs");
  const attachments = new Attachments(f.vault),
    refs = new References(f.vault),
    files = new DocumentFiles(
      f.vault,
      attachments,
      refs,
      p => fs.rename(p, path.join(f.root, "trashed-" + path.basename(p))),
    );
  await f.vault.create("folder", "folder");
  let doc = await f.vault.create("folder/a.md", "file", "before");
  await attachments.documents.sync(doc.path, doc.content);
  doc = await f.vault.save(doc.path, "after", doc.version);
  const id = (await f.history.list(doc.path)).entries[1].id;
  await files.rename({ from: doc.path, to: "folder/b.md" });
  assert.equal((await f.history.read("folder/b.md", id)).content, "before");
  await files.rename({ from: "folder", to: "moved" });
  assert.equal((await f.history.read("moved/b.md", id)).content, "before");
  await files.copy({ from: "moved/b.md", to: "copy.md" });
  assert.equal((await f.history.list("copy.md")).entries.length, 0);
  await files.remove({ path: "moved/b.md" });
  assert.equal((await f.history.list("moved/b.md")).entries.length, 0);
  assert.equal(await fs.stat(path.join(f.root, "moved/b.md")).catch(() => null), null);
});
test("Compressed history is bounded by output length and cannot follow symbolic links outside its data directory", async () => {
  const f = await fixture();
  let doc = await f.vault.create("note.md", "file", "old");
  doc = await f.vault.save(doc.path, "new", doc.version);
  const file=f.history.database.file,id=(await f.history.list(doc.path)).entries[0].id;
  const db=new DatabaseSync(file);db.prepare("UPDATE history SET data=? WHERE document=? AND id=?").run(require("node:zlib").gzipSync("x".repeat(MAX_TEXT+1)),doc.path,id);db.close();
  await assert.rejects(f.history.read(doc.path,id));
  await fs.mkdir(path.join(f.root, "outside"));
  await fs.symlink(path.join(f.root, "outside"), file+"-journal", "junction");
  await assert.rejects(f.history.list(doc.path), /链接/);
});

test("History configuration applies to new captures and retention, while disabling recording still permits a backed-up restoration", async () => {
  const f = await fixture();
  let doc = await f.vault.create("settings.md", "file", "zero");
  doc = await f.vault.save(doc.path, "one", doc.version);
  const original = (await f.history.list(doc.path)).entries.at(-1).id;
  f.history.configure({ enabled: false });
  f.advance(INTERVAL);
  doc = await f.vault.save(doc.path, "two", doc.version);
  assert.equal((await f.history.list(doc.path)).enabled, false);
  assert.equal((await f.history.list(doc.path)).entries.length, 2);
  assert.equal(
    (await f.history.prepareRestore({
      document: doc.path,
      id: original,
      version: doc.version,
      content: "unsaved draft",
    })).content,
    "zero",
  );
  assert.equal(
    (await f.history.read(doc.path, (await f.history.list(doc.path)).entries[0].id)).content,
    "unsaved draft",
  );
  f.history.configure({ enabled: true, intervalMinutes: 1, maxEntries: 5, retentionDays: 1 });
  for (let i = 0; i < 8; i++) {
    f.advance(60000);
    doc = await f.vault.save(doc.path, "entry " + i, doc.version);
  }
  const list = await f.history.list(doc.path);
  assert.equal(list.interval, 60000);
  assert.equal(list.limit, 5);
  assert.equal(list.retentionDays, 1);
  assert.equal(list.entries.length, 5);
  f.advance(2 * 86400000);
  assert.equal((await f.history.list(doc.path)).entries.length, 0);
});

test("Large incompressible histories discard oldest entries at the archive byte limit and retain the newest exact text", async () => {
  const f = await fixture();
  let doc = await f.vault.create("large.md", "file", "original");
  for (let i = 0; i < 4; i++) {
    f.advance(INTERVAL);
    const text = require("node:crypto").randomBytes(1200000).toString("base64");
    doc = await f.vault.save(doc.path, text, doc.version);
  }
  const list = await f.history.list(doc.path);
  assert(list.entries.length < 5);
  assert(list.entries.length >= 1);
  assert(historySize(f.history.database.file,doc.path)<=MAX_STORE);
  assert.equal((await f.history.read(doc.path, list.entries[0].id)).content, doc.content);
});
