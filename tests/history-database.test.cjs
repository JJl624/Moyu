const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  zlib = require("node:zlib"),
  { DatabaseSync } = require("node:sqlite");
const { Vault } = require("../electron/vault.cjs"),
  { DocumentHistory } = require("../electron/document-history.cjs"),
  { Attachments } = require("../electron/attachments.cjs"),
  { References } = require("../electron/references.cjs"),
  { DocumentFiles } = require("../electron/document-files.cjs");
const base = path.resolve(__dirname, "../../../work/history-sqlite-tests");
async function fixture(t) {
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, "case-")),
    vault = await new Vault(root).init(),
    history = vault.history = new DocumentHistory(vault);
  t.after(async () => {
    assert(root.startsWith(base + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, vault, history, database: history.database };
}
function query(file, sql, ...args) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare(sql).all(...args);
  } finally {
    db.close();
  }
}
async function legacy(f, document = "目录/a.md") {
  const content = "原始内容\r\n",
    id = crypto.randomUUID(),
    entries = [{
      id,
      time: Date.now() - 1,
      reason: "saved",
      bytes: Buffer.byteLength(content),
      data: zlib.gzipSync(content).toString("base64"),
    }],
    relative = ".data/history/" + document + "/versions.json",
    file = path.join(f.root, relative),
    bytes = JSON.stringify({ version: 1, entries });
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes);
  return { file, relative, id, content, bytes };
}

test("Legacy history migrates transactionally with exact backups; indexes and ownership files stay byte-identical", async t => {
  const f = await fixture(t), old = await legacy(f);
  const unchanged = [".data/document_map.json", ".data/attachment_map.json", "a.assets/document.json"];
  for (const name of unchanged) {
    await fs.mkdir(path.dirname(path.join(f.root, name)), { recursive: true });
    await fs.writeFile(path.join(f.root, name), "untouched");
  }
  assert.equal((await f.history.read("目录/a.md", old.id)).content, old.content);
  assert.equal(
    await fs.readFile(path.join(f.root, old.relative.replace("/history/", "/history-legacy/")), "utf8"),
    old.bytes,
  );
  assert.equal(await fs.stat(old.file).catch(() => null), null);
  for (const name of unchanged) assert.equal(await fs.readFile(path.join(f.root, name), "utf8"), "untouched");
  const tables = query(f.database.file, "SELECT name FROM sqlite_master WHERE type='table'").map(r => r.name);
  assert(!tables.includes("documents"));
  assert(!tables.includes("attachment_refs"));
  const bytes = await fs.readFile(f.database.file), time = (await fs.stat(f.database.file)).mtimeMs;
  for (let i = 0; i < 4; i++) await new DocumentHistory(await new Vault(f.root).init()).list("目录/a.md");
  assert.deepEqual(await fs.readFile(f.database.file), bytes);
  assert.equal((await fs.stat(f.database.file)).mtimeMs, time);
});

test("Invalid legacy contents leave the original files intact and the entire import can be retried", async t => {
  const f = await fixture(t), good = await legacy(f, "a.md"), bad = await legacy(f, "b.md");
  await fs.writeFile(bad.file, "broken");
  await assert.rejects(f.history.list("a.md"));
  assert.equal(query(f.database.file, "SELECT name FROM sqlite_master WHERE type='table'").length, 0);
  assert.equal(await fs.readFile(good.file, "utf8"), good.bytes);
  await fs.writeFile(bad.file, bad.bytes);
  assert.equal((await f.history.read("a.md", good.id)).content, good.content);
  assert.equal((await f.history.list("b.md")).entries.length, 1);
});

test("A backup collision never removes the committed database or overwrites an existing backup", async t => {
  const f = await fixture(t),
    old = await legacy(f, "a.md"),
    target = path.join(f.root, ".data/history-legacy/a.md/versions.json");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, "keep");
  await assert.rejects(f.history.list("a.md"), /备份已存在/);
  assert.equal(query(f.database.file, "SELECT COUNT(*) AS n FROM history")[0].n, 1);
  assert.equal(await fs.readFile(target, "utf8"), "keep");
  await fs.unlink(target);
  assert.equal((await f.history.read("a.md", old.id)).content, old.content);
});

test("Database corruption only warns after a successful Markdown save; a missing archive is not created by queries", async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.history.list("a.md")).entries, []);
  assert.equal(await fs.stat(f.database.file).catch(() => null), null);
  let doc = await f.vault.create("a.md", "file", "before");
  await fs.mkdir(path.dirname(f.database.file), { recursive: true });
  await fs.writeFile(f.database.file, "damaged");
  const saved = await f.vault.save(doc.path, "after", doc.version);
  assert.match(saved.historyWarning, /文档已保存/);
  assert.equal((await f.vault.read(doc.path)).content, "after");
  assert.equal(await fs.readFile(f.database.file, "utf8"), "damaged");
});

test("Read-only history queries do not write, and linked database journals are refused without touching their targets", async t => {
  const f = await fixture(t);
  const doc = await f.vault.create("a.md", "file", "before");
  await f.vault.save(doc.path, "after", doc.version);
  const before = await fs.readFile(f.database.file);
  f.vault.recoveryError = "readonly";
  assert.equal((await f.history.list("a.md")).entries.length, 2);
  assert.deepEqual(await fs.readFile(f.database.file), before);
  await assert.rejects(f.history.clear(), /readonly/);
  const target = path.join(f.root, "outside");
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, "keep"), "keep");
  await fs.symlink(target, f.database.file + "-journal", "junction");
  await assert.rejects(f.history.list("a.md"), /链接/);
  assert.equal(await fs.readFile(path.join(target, "keep"), "utf8"), "keep");
});

test("A rename failure after the history commit rolls the archive and file metadata back together", async t => {
  const f = await fixture(t),
    attachments = new Attachments(f.vault),
    refs = new References(f.vault),
    files = new DocumentFiles(f.vault, attachments, refs, () => {});
  const doc = await f.vault.create("a.md", "file", "before");
  await attachments.documents.sync(doc.path, doc.content);
  await f.vault.save(doc.path, "after", doc.version);
  const id = (await f.history.list("a.md")).entries.at(-1).id, unlink = fs.unlink;
  let failed = false;
  fs.unlink = async function(file, ...args) {
    if (!failed && file === path.join(f.root, ".data/rename-transaction.json")) {
      failed = true;
      throw Error("injected failure");
    }
    return unlink.call(this, file, ...args);
  };
  try {
    await assert.rejects(files.rename({ from: "a.md", to: "b.md" }), /injected failure/);
  } finally {
    fs.unlink = unlink;
  }
  assert.equal((await f.history.read("a.md", id)).content, "before");
  assert.equal((await f.vault.read("a.md")).content, "after");
  assert.equal((await f.history.list("b.md")).entries.length, 0);
  assert.equal(query(f.database.file, "SELECT COUNT(*) AS n FROM operations")[0].n, 0);
});

test("Failed deletion keeps history, successful trash cleanup removes it, and interrupted operations recover after restart", async t => {
  const f = await fixture(t),
    attachments = new Attachments(f.vault),
    refs = new References(f.vault),
    files = new DocumentFiles(f.vault, attachments, refs, () => {
      throw Error("trash failed");
    });
  const doc = await f.vault.create("a.md", "file", "before");
  await attachments.documents.sync(doc.path, doc.content);
  await f.vault.save(doc.path, "after", doc.version);
  await assert.rejects(files.remove({ path: "a.md" }), /trash failed/);
  assert.equal((await f.history.list("a.md")).entries.length, 2);
  const operation = await f.history.move("a.md", "b.md");
  await f.history.apply(operation);
  const restarted = new DocumentHistory(await new Vault(f.root).init());
  await restarted.rollback(operation);
  assert.equal((await restarted.list("a.md")).entries.length, 2);
  const deletion = { id: crypto.randomUUID(), from: "a.md", remove: true };
  await restarted.apply(deletion);
  await restarted.recover();
  assert.equal((await restarted.list("a.md")).entries.length, 0);
  assert.equal(query(f.database.file, "SELECT COUNT(*) AS n FROM operations")[0].n, 0);
});

test("Lists omit snapshot bodies, internal database viewing takes a consistent read, and clearing history preserves original indexes", async t => {
  const f = await fixture(t), doc = await f.vault.create("O'Brien.md", "file", "before");
  await f.vault.save(doc.path, "after", doc.version);
  await fs.writeFile(path.join(f.root, ".data/document_map.json"), "keep");
  const list = await f.history.list(doc.path);
  assert.equal(list.entries.length, 2);
  assert(list.entries.every(e => !("data" in e)));
  const bytes = await require("../electron/file-viewers.cjs").binaryRead(
    f.vault,
    ".data/history.sqlite",
    true,
  );
  assert.equal(Buffer.from(bytes).subarray(0, 16).toString(), "SQLite format 3\0");
  await f.history.clear();
  assert.equal((await f.history.list(doc.path)).entries.length, 0);
  assert.equal(await fs.readFile(path.join(f.root, ".data/document_map.json"), "utf8"), "keep");
});

test("A restart recovers a real rename journal after both journal cleanup and the immediate rollback were interrupted", async t => {
  const f = await fixture(t),
    attachments = new Attachments(f.vault),
    refs = new References(f.vault),
    files = new DocumentFiles(f.vault, attachments, refs, () => {});
  const doc = await f.vault.create("a.md", "file", "before");
  await attachments.documents.sync(doc.path, doc.content);
  await f.vault.save(doc.path, "after", doc.version);
  const id = (await f.history.list("a.md")).entries.at(-1).id, unlink = fs.unlink;
  refs.rollback = async () => {
    throw Error("interrupted rollback");
  };
  fs.unlink = async function(file, ...args) {
    if (file === path.join(f.root, ".data/rename-transaction.json")) throw Error("interrupted cleanup");
    return unlink.call(this, file, ...args);
  };
  try {
    await assert.rejects(files.rename({ from: "a.md", to: "b.md" }), /interrupted/);
  } finally {
    fs.unlink = unlink;
  }
  assert.equal((await f.vault.read("b.md")).content, "after");
  const next = await new Vault(f.root).init();
  next.history = new DocumentHistory(next);
  await new References(next).recover();
  await next.history.recover();
  assert.equal((await next.read("a.md")).content, "after");
  assert.equal((await next.history.read("a.md", id)).content, "before");
  assert.equal((await next.history.list("b.md")).entries.length, 0);
  assert.equal(await fs.stat(path.join(f.root, ".data/rename-transaction.json")).catch(() => null), null);
});

test("A restart finalizes a deletion whose files reached the trash before the completion journal could be written", async t => {
  const f = await fixture(t),
    attachments = new Attachments(f.vault),
    refs = new References(f.vault),
    files = new DocumentFiles(f.vault, attachments, refs, p => fs.rename(p, path.join(f.root, "trashed")));
  const doc = await f.vault.create("a.md", "file", "before");
  await attachments.documents.sync(doc.path, doc.content);
  await f.vault.save(doc.path, "after", doc.version);
  const saveJournal = files.saveJournal.bind(files);
  files.saveJournal = async record => {
    if (record.phase === "complete") throw Error("interrupted completion");
    return saveJournal(record);
  };
  files.rollback = async () => {
    throw Error("interrupted rollback");
  };
  await assert.rejects(files.remove({ path: "a.md" }), /interrupted/);
  assert.equal(await fs.stat(path.join(f.root, "a.md")).catch(() => null), null);
  assert.equal((await f.history.list("a.md")).entries.length, 2);
  const next = await new Vault(f.root).init();
  next.history = new DocumentHistory(next);
  const nextAttachments = new Attachments(next),
    nextRefs = new References(next),
    nextFiles = new DocumentFiles(next, nextAttachments, nextRefs, () => {});
  await nextFiles.recover();
  await next.history.recover();
  assert.equal((await next.history.list("a.md")).entries.length, 0);
  assert.equal(await fs.stat(path.join(f.root, ".data/file-transaction.json")).catch(() => null), null);
});
