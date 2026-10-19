const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Vault } = require("../electron/vault.cjs");
const tempBase = path.resolve(__dirname, "../../..", "work", "vault-tests");
let root, vault;
beforeEach(async () => {
  await fs.mkdir(tempBase, { recursive: true });
  root = await fs.mkdtemp(path.join(tempBase, "case-"));
  vault = await new Vault(root).init();
});
afterEach(async () => {
  const resolved = path.resolve(root);
  assert.equal(path.dirname(resolved), tempBase);
  await fs.rm(resolved, { recursive: true, force: true });
});
test("Markdown round trip creates no metadata folder and serializes concurrent writes", async () => {
  const first = await vault.create("文档.md", "file", "# Hello\n\n中文正文\n");
  const saved = await vault.save(
    "文档.md",
    "# Updated\n\n新内容\n",
    first.version,
  );
  assert.equal((await vault.read("文档.md")).content, "# Updated\n\n新内容\n");
  assert.equal(await fs.stat(path.join(root,'.data')).catch(()=>null),null);
  const results = await Promise.allSettled([
    vault.save("文档.md", "writer one", saved.version),
    vault.save("文档.md", "writer two", saved.version),
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.equal(results[1].reason.code, "CONFLICT");
  assert.equal((await vault.read("文档.md")).content, "writer one");
});
test("External edit conflict never silently overwrites disk", async () => {
  const document = await vault.create("note.md", "file", "original");
  await fs.writeFile(path.join(root, "note.md"), "external edit");
  await assert.rejects(
    vault.save("note.md", "my edit", document.version),
    (error) =>
      error.code === "CONFLICT" && error.current.content === "external edit",
  );
  assert.equal(
    await fs.readFile(path.join(root, "note.md"), "utf8"),
    "external edit",
  );
});
test("Tree, Unicode names, nested search and no overwrite during rename", async () => {
  await vault.create("我的笔记", "folder");
  await vault.create("我的笔记/灵感.md", "file", "# 日记\nunique needle\n");
  await vault.create("existing.md", "file", "keep me");
  await fs.writeFile(path.join(root, "ignored.txt"), "needle");
  const state = await vault.list();
  assert.equal(state.tree.length, 3);
  assert(state.tree.some(f => f.name === "ignored.txt"));
  const results = await vault.search("needle");
  assert.equal(results.length, 1);
  assert.equal(results[0].matches[0].line, 2);
  await assert.rejects(
    vault.rename("我的笔记/灵感.md", "existing.md"),
    (error) => error.code === "EXISTS",
  );
  await vault.rename("我的笔记", "思考");
  assert.equal(
    (await vault.read("思考/灵感.md")).content,
    "# 日记\nunique needle\n",
  );
});
test("Traversal, hidden internal paths, invalid filenames and outside symlinks are blocked", async () => {
  for (const target of [
    "../escape.md",
    ".moyu/config.md",
    "/absolute.md",
    "C:/absolute.md",
    "a\\b.md",
  ])
    await assert.rejects(vault.create(target, "file", "bad"));
  for (const target of ["con.md", "a:b.md", "bad?.md"])
    await assert.rejects(vault.create(target, "file", "bad"));
  const outside = await fs.mkdtemp(path.join(tempBase, "outside-"));
  try {
    await fs.symlink(
      outside,
      path.join(root, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(vault.create("escape/outside.md", "file", "bad"));
    assert.deepEqual(await fs.readdir(outside), []);
  } finally {
    assert.equal(path.dirname(path.resolve(outside)), tempBase);
    await fs.rm(outside, { recursive: true, force: true });
  }
});
test("Attachments remain relative and cannot upload executable content", async () => {
  await vault.create("note.md", "file", "note");
  const relative = await vault.attachment(
    "note.md",
    "image.png",
    new Uint8Array([137, 80, 78, 71]),
  );
  assert.equal(decodeURIComponent(relative),'note.assets/attachments/image.png');
  assert.deepEqual(
    [...(await fs.readFile(path.join(root, decodeURIComponent(relative))))],
    [137, 80, 78, 71],
  );
  await assert.rejects(
    vault.attachment("note.md", "bad.svg", new Uint8Array([1])),
  );
});
test("Ordinary saves never access an obsolete internal recovery junction", async () => {
  const document = await vault.create("note.md", "file", "original");
  const outside = await fs.mkdtemp(path.join(tempBase, "backup-outside-"));
  try {
    await fs.symlink(
      outside,
      path.join(root, ".data"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await vault.save("note.md", "updated", document.version);
    assert.deepEqual(await fs.readdir(outside), []);
    assert.equal((await vault.read("note.md")).content, "updated");
  } finally {
    assert.equal(path.dirname(path.resolve(outside)), tempBase);
    await fs.rm(outside, { recursive: true, force: true });
  }
});
