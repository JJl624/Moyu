const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Vault } = require("../electron/vault.cjs");
const { WebDAVSync } = require("../electron/sync.cjs");
const { Drawings } = require("../electron/drawings.cjs");
const { Connections } = require("../electron/connections.cjs");
const { davServer } = require("./helpers/dav-server.cjs");
const base = path.resolve(__dirname, "../../../work/feature-tests");
async function fixture(t) {
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, "case-"));
  t.after(async () => {
    assert.equal(path.dirname(root), base);
    await fs.rm(root, { recursive: true, force: true });
  });
  return new Vault(root).init();
}
test("WebDAV uploads and downloads Unicode paths, attachments, drawings; excludes private files", async (t) => {
  const vault = await fixture(t),
    server = await davServer();
  t.after(server.close);
  const sync = new WebDAVSync(vault, async () => ({
    url: server.url,
    directory: "/Moyu",
    username: "user",
    password: "secret",
    sync: { deletion: 'sync' },
  }));
  await vault.create("目录", "folder");
  await vault.create("目录/笔记 & 1.md", "file", "# 原文");
  await fs.mkdir(path.join(vault.root, "assets"));
  await fs.writeFile(
    path.join(vault.root, "assets/a.png"),
    Buffer.from([0, 1, 2, 255]),
  );
  await new Drawings(vault).create({ path: "图.excalidraw" });
  await fs.mkdir(path.join(vault.root, ".private"));
  await fs.writeFile(path.join(vault.root, ".private/config"), "secret");
  assert.match((await sync.test()).message, /^连接成功/);
  const first = await sync.sync();
  assert.equal(first.conflicts.length, 0);
  assert.equal(first.changes.length, 3);
  assert.equal(server.files.get("/Moyu/目录/笔记 & 1.md").toString(), "# 原文");
  assert(!server.files.has("/Moyu/.private/config"));
  server.files.set("/Moyu/目录/笔记 & 1.md", Buffer.from("# 远端更新"));
  server.files.set("/Moyu/新文件.md", Buffer.from("# 新文件"));
  await sync.sync();
  assert.equal((await vault.read("目录/笔记 & 1.md")).content, "# 远端更新");
  assert.equal((await vault.read("新文件.md")).content, "# 新文件");
  const current = await vault.read("目录/笔记 & 1.md");
  await vault.save(current.path, "# 本地更新", current.version);
  server.files.set("/Moyu/目录/笔记 & 1.md", Buffer.from("# 第二台更新"));
  const conflict = (await sync.sync()).conflicts[0];
  assert.equal(conflict.localText, "# 本地更新");
  assert.equal(conflict.remoteText, "# 第二台更新");
  assert.equal((await vault.read(current.path)).content, "# 本地更新");
  const resolved = await sync.resolve({ ...conflict, choice: "remote" });
  assert.equal(resolved.conflicts.length, 0);
  assert.equal((await vault.read(current.path)).content, "# 第二台更新");
  server.files.delete("/Moyu/新文件.md");
  await sync.sync();
  await assert.rejects(vault.read("新文件.md"), { code: "ENOENT" });
  await fs.unlink(path.join(vault.root, "assets/a.png"));
  await sync.sync();
  assert(!server.files.has("/Moyu/assets/a.png"));
  assert(
    (await fs.readdir(path.join(vault.root, ".data/recovery"))).length > 0,
  );
});
test("WebDAV races and missing ETags cannot silently overwrite remote changes", async (t) => {
  const vault = await fixture(t),
    server = await davServer();
  t.after(server.close);
  const sync = new WebDAVSync(vault, async () => ({
    url: server.url,
    directory: "/Moyu",
    username: "user",
    password: "secret",
  }));
  let doc = await vault.create("a.md", "file", "base");
  await sync.sync();
  doc = await vault.save("a.md", "mine", doc.version);
  server.setRace({ path: "/Moyu/a.md", content: "concurrent" });
  await assert.rejects(sync.sync());
  assert.equal(server.files.get("/Moyu/a.md").toString(), "concurrent");
  const c = (await sync.sync()).conflicts[0];
  assert(c);
  server.files.set("/Moyu/a.md", Buffer.from("newer"));
  await assert.rejects(sync.resolve({ ...c, choice: "local" }), {
    code: "CONFLICT",
  });
  const latest = (await sync.sync()).conflicts[0];
  await sync.resolve({ ...latest, choice: "local" });
  assert.equal(server.files.get("/Moyu/a.md").toString(), "mine");
  await vault.save("a.md", "another", doc.version);
  server.noETag();
  await assert.rejects(sync.sync(), /ETag/);
});

test("Drawing saves use optimistic versions and portable scene/image files", async (t) => {
  const vault = await fixture(t),
    drawings = new Drawings(vault);
  const doc = await drawings.create({ path: "图.excalidraw" });
  const scene = JSON.parse(doc.content);
  scene.elements = [{ id: "rectangle", type: "rectangle", x: 10, y: 10 }];
  const saved = await drawings.save({
    path: doc.path,
    content: JSON.stringify(scene),
    version: doc.version,
  });
  await assert.rejects(
    drawings.save({
      path: doc.path,
      content: doc.content,
      version: doc.version,
    }),
    { code: "CONFLICT" },
  );
  assert.equal(
    JSON.parse((await drawings.read(doc.path)).content).elements.length,
    1,
  );
  const image = await drawings.image({
    path: doc.path,
    format: "png",
    bytes: Uint8Array.from([137, 80, 78, 71]),
  });
  assert.equal(
    (await fs.readFile(path.join(vault.root, image.path))).length,
    4,
  );
  assert.notEqual(saved.version, doc.version);
  await assert.rejects(drawings.create({ path: "../bad.excalidraw" }));
});
test("Credentials are encrypted outside the vault and omitted from renderer responses", async (t) => {
  const vault = await fixture(t);
  const directory = path.join(vault.root, "user-data");
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s.split("").reverse().join("")),
    decryptString: (b) => b.toString().split("").reverse().join(""),
  };
  const connections = new Connections(directory, storage);
  const state = await connections.save("workspace-1", "webdav", {
    url: "https://example.com/dav",
    directory: "/Moyu",
    username: "u",
    password: "my-secret",
  });
  assert.equal(state.webdav.password, undefined);
  assert.equal(state.webdav.hasPassword, true);
  assert.equal(
    (await connections.get("workspace-1", true)).webdav.password,
    "my-secret",
  );
  assert(
    !(await fs.readFile(connections.file("workspace-1"), "utf8")).includes(
      "my-secret",
    ),
  );
  await connections.save("workspace-1", "webdav", {
    url: "https://example.com/dav",
    clearPassword: true,
  });
  assert.equal(
    (await connections.get("workspace-1")).webdav.hasPassword,
    false,
  );
  await assert.rejects(
    connections.save("workspace-1", "webdav", {
      url: "https://u:secret@example.com",
    }),
  );
});
