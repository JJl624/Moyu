const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path");
const { ManualRuntimeFiles } = require("../electron/manual-runtime-files.cjs"),
  { ManagedRuntimes } = require("../electron/managed-runtimes.cjs"),
  { PythonManager } = require("../electron/python.cjs"),
  { RuntimeContents, packageURL } = require("../electron/runtime-contents.cjs");
async function fixture(t) {
  const root = await fs.mkdtemp(path.resolve(__dirname, "../../../work/runtime-contents-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manual = new ManualRuntimeFiles({ runtimes: new ManagedRuntimes(root), python: new PythonManager(root) });
  return { root, manual, contents: new RuntimeContents(manual) };
}
async function makeArchive(file, metadata) {
  const json = Buffer.from(JSON.stringify(metadata)), header = Buffer.alloc(512);
  header.write("package/package.json");
  header.write("0000644\0", 100);
  header.write(json.length.toString(8).padStart(11, "0") + "\0", 124);
  header.write("0", 156);
  await fs.writeFile(
    file,
    require("node:zlib").gzipSync(
      Buffer.concat([header, json, Buffer.alloc((512 - json.length % 512) % 512), Buffer.alloc(1024)]),
    ),
  );
}
test("Default environment contents work offline, separate compilers from formatters, and do not create managed environments", async t => {
  const { root, contents } = await fixture(t), previous = global.fetch;
  global.fetch = async () => {
    throw Error("Unexpected network");
  };
  t.after(() => global.fetch = previous);
  for (const language of ["clang", "sql", "lua", "ruby", "bash", "java", "csharp", "python"]) {
    const result = await contents.describe(language);
    assert(result.groups[0].files.length > 0);
    if (["java", "csharp"].includes(language)) {
      assert.equal(result.groups[0].title, "编译器与标准库");
      assert.equal(result.groups[1].title, "格式化插件与依赖");
      assert.equal(result.groups[0].files.length, language === "java" ? 4 : 1);
      if (language === 'csharp') assert.equal(result.groups[0].files[0].requiredFiles.length, 211);
      assert(result.groups[1].files.every(file => file.url.startsWith("https://")));
    }
  }
  assert.equal(await fs.stat(path.join(root, "runtimes")).catch(() => null), null);
});

test('Inventories preserve archive dependency relationships and omit Moyu adapter/manifest files', async t => {
  const { manual, contents } = await fixture(t);
  const lua = await contents.describe('lua');
  const main = lua.groups[0].files.find(file => file.package === 'wasmoon');
  assert.deepEqual(main.dependencyIds, ['npm:@types/emscripten@1.39.10']);
  const plan = await manual.create('lua');
  assert.deepEqual(plan.files.find(file => file.package === 'wasmoon').dependencyIds, main.dependencyIds);
  const manager = manual.manager('sql'), directory = manager.directory('sql', manager.definition('sql').recommended);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ bundledPackages: [{ name: 'sql.js', version: '1.14.2' }] }));
  await fs.writeFile(path.join(directory, 'viewer-runtime.mjs'), '// generated adapter');
  const installed = await contents.describe('sql');
  assert.equal(installed.installed, true);
  assert.equal(installed.groups[0].files[0].name, 'sql.js-1.14.2.tgz');
  assert(!JSON.stringify(installed.groups).includes('manifest.json'));
  assert(!JSON.stringify(installed.groups).includes('viewer-runtime'));
  assert.equal(await fs.readFile(path.join(directory, 'viewer-runtime.mjs'), 'utf8'), '// generated adapter');
});
test("Reading many environment inventories never evicts the user's pending import selection", async t => {
  const { manual, contents } = await fixture(t), selected = await manual.create("sql");
  for (let i = 0; i < 20; i++) await contents.describe("java");
  assert.equal(manual.get(selected.token, "sql").token, selected.token);
});
test("Local file selection identifies a renamed archive and has no phantom unmatched file", async t => {
  const { root, manual } = await fixture(t), archive = path.join(root, "环境包.tgz");
  await makeArchive(archive, { name: "sql.js", version: "1.14.1", dependencies: {} });
  const result = await manual.chooseFiles("sql", [archive]);
  assert.equal(result.version, "1.14.1");
  assert(result.files.every(file => file.verified));
  assert.deepEqual(result.unmatched || [], []);
});
test("Reselecting the same primary archive preserves verified dependencies; corrupt picks cannot enable installation", async t => {
  const { root, manual } = await fixture(t),
    archive = path.join(root, "wasmoon.tgz"),
    dependencyFile = path.join(root, "helper.tgz");
  await makeArchive(archive, { name: "wasmoon", version: "1.15.0", dependencies: { "moyu-test-helper": "^1.0.0" } });
  await makeArchive(dependencyFile, { name: "moyu-test-helper", version: "1.2.3", dependencies: {} });
  const plan = await manual.identify("lua", archive),
    dependency = plan.files.find(file => file.package === "moyu-test-helper");
  await manual.select({ language: "lua", token: plan.token, id: dependency.id, paths: [dependencyFile] });
  const first = await manual.identify("lua", archive, plan.token);
  assert.equal(first.token, plan.token);
  assert(first.files.every(file => file.verified));
  const wrong = path.join(root, "wrong.tgz");
  await fs.writeFile(wrong, "not an archive");
  await assert.rejects(manual.identify("lua", wrong, plan.token), /归档/);
  const failed = await manual.create("lua", "1.15.0", plan.token);
  assert(failed.files.find(file => file.package === "wasmoon").error);
  assert(failed.files.find(file => file.package === "moyu-test-helper").verified);
  await assert.rejects(manual.install({ language: "lua", token: plan.token }), /验证/);
  assert((await manual.identify("lua", archive, plan.token)).files.every(file => file.verified));
});
test("Package links use recorded tarball URLs and mirror paths; unknown local versions never get an invented download URL", () => {
  assert.equal(
    packageURL("sql.js", "1.14.2", "https://mirror.example.com/npm/"),
    "https://mirror.example.com/npm/sql.js/-/sql.js-1.14.2.tgz",
  );
  assert.equal(packageURL("custom-package", "1.0.0"), "");
  assert.equal(
    packageURL("custom-package", "1.0.0", "https://mirror.example.com/", "https://downloads.example.com/archive.tgz"),
    "https://downloads.example.com/archive.tgz",
  );
  assert.throws(
    () => packageURL("custom-package", "1.0.0", undefined, "http://downloads.example.com/archive.tgz"),
    /下载地址/,
  );
});
