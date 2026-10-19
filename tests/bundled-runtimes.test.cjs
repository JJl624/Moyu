const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { ManagedRuntimes } = require("../electron/managed-runtimes.cjs");
const { initializeBundledRuntimes } = require("../electron/bundled-runtimes.cjs");
async function fixture(t) {
  const root = await fs.mkdtemp(path.resolve(__dirname, "../../../work/bundled-unit-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bundle = path.join(root, "bundle"), source = path.join(bundle, "sql/1.14.2");
  await fs.mkdir(source, { recursive: true });
  const files = {};
  for (
    const [name, bytes] of Object.entries({
      "manifest.json": Buffer.from(JSON.stringify({ kind: "sql", version: "1.14.2", files: {}, size: 5 })),
      "sql-runtime.mjs": Buffer.from("module"),
    })
  ) {
    await fs.writeFile(path.join(source, name), bytes);
    files[name] = { bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  }
  await fs.writeFile(
    path.join(bundle, "index.json"),
    JSON.stringify({ version: 1, runtimes: [{ kind: "sql", version: "1.14.2", files }] }),
  );
  return { root, bundle, source, files, manager: new ManagedRuntimes(path.join(root, "data")) };
}
test("Bundled defaults initialize once without network, and an explicit removal survives restart", async t => {
  const { root, bundle, manager } = await fixture(t);
  await Promise.all([initializeBundledRuntimes(manager, bundle), initializeBundledRuntimes(manager, bundle)]);
  assert.equal((await manager.state("sql")).selected, "1.14.2");
  const target = manager.directory("sql", "1.14.2"),
    stat = await fs.stat(path.join(target, "sql-runtime.mjs")),
    config = await fs.stat(path.join(manager.root, "sql/versions.json"));
  await initializeBundledRuntimes(new ManagedRuntimes(path.join(root, "data")), bundle);
  assert.equal((await fs.stat(path.join(target, "sql-runtime.mjs"))).mtimeMs, stat.mtimeMs);
  assert.equal((await fs.stat(path.join(manager.root, "sql/versions.json"))).mtimeMs, config.mtimeMs);
  await manager.remove({ language: "sql", version: "1.14.2" });
  await initializeBundledRuntimes(new ManagedRuntimes(path.join(root, "data")), bundle);
  assert.equal((await manager.state("sql")).selected, "");
  assert.equal(await fs.stat(target).catch(() => null), null);
});
test("Corrupt bundled files never publish or register a partial environment, and retry can recover", async t => {
  const { bundle, source, manager } = await fixture(t);
  await fs.writeFile(path.join(source, "sql-runtime.mjs"), "broken");
  await assert.rejects(initializeBundledRuntimes(manager, bundle), /校验/);
  assert.equal((await manager.state("sql")).installed.length, 0);
  assert.deepEqual(await fs.readdir(path.join(manager.root, "sql/staging")), []);
  await fs.writeFile(path.join(source, "sql-runtime.mjs"), "module");
  await initializeBundledRuntimes(manager, bundle);
  assert.equal((await manager.state("sql")).selected, "1.14.2");
});
test("Bundled defaults preserve an existing selection and reject unsafe paths", async t => {
  const { bundle, manager } = await fixture(t);
  await manager.write("sql", { selected: "1.13.0", versions: ["1.13.0"] });
  await initializeBundledRuntimes(manager, bundle);
  assert.equal((await manager.state("sql")).selected, "1.13.0");
  const other = new ManagedRuntimes(path.join(manager.root, "other")),
    index = JSON.parse(await fs.readFile(path.join(bundle, "index.json"), "utf8"));
  index.runtimes[0].files["../outside"] = { bytes: 0, sha256: "0".repeat(64) };
  await fs.writeFile(path.join(bundle, "index.json"), JSON.stringify(index));
  await assert.rejects(initializeBundledRuntimes(other, bundle), /路径/);
  assert.equal((await other.state("sql")).installed.length, 0);
});
