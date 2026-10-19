const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path");
const { ManualRuntimeFiles } = require("../electron/manual-runtime-files.cjs"),
  { ManagedRuntimes } = require("../electron/managed-runtimes.cjs"),
  { PythonManager } = require("../electron/python.cjs");
async function fixture(t) {
  const root = await fs.mkdtemp(path.resolve(__dirname, "../../../work/manual-files-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runtimes = new ManagedRuntimes(root), python = new PythonManager(root);
  return { root, runtimes, files: new ManualRuntimeFiles({ runtimes, python }) };
}
test("All eight manual environment file lists are available offline, identify actual files, and keep language tokens isolated", async t => {
  const { files } = await fixture(t), fetch = global.fetch;
  global.fetch = async () => {
    throw Error("unexpected network");
  };
  t.after(() => global.fetch = fetch);
  for (const language of ["python", "clang", "sql", "lua", "ruby", "bash", "csharp", "java"]) {
    const plan = await files.create(language);
    assert(plan.files.length > 0);
    assert(plan.files.every(file => file.name && (file.type === "bundle" ? file.projectURL === "https://github.com/wieslawsoltes/RoslynWeb" && file.requiredFiles.every(item => item.url.startsWith("https://")) : file.url.startsWith("https://"))));
    assert(plan.files.every(file => !file.path));
    assert.throws(() => files.get(plan.token, "other"), /清单/);
  }
  await assert.rejects(files.create("[object Object]"), /不支持/);
});
test("Wrong SDK files fail checksums, cannot install, and do not change the installed environment", async t => {
  const { root, runtimes, files } = await fixture(t),
    plan = await files.create("csharp"),
    source = path.join(root, "wrong.wasm");
  await fs.writeFile(source, "not SDK bytes");
  const checked = await files.select({
    language: "csharp",
    token: plan.token,
    id: plan.files[0].id,
    paths: [source],
  });
  assert.equal(checked.files[0].verified, false);
  assert.match(checked.files[0].error, /不匹配|压缩包无效/);
  await assert.rejects(files.install({ language: "csharp", token: plan.token }), /全部必需文件/);
  assert.deepEqual((await runtimes.state("csharp")).installed, []);
});
test("Python file selection validates all five real distribution files and reports unmatched inputs", async t => {
  const { root, files } = await fixture(t),
    plan = await files.create("python", "314.0.7"),
    extra = path.join(root, "extra.txt");
  await fs.writeFile(extra, "extra");
  const checked = await files.select({
    language: "python",
    token: plan.token,
    paths: [...plan.files.map(file => path.resolve(__dirname, "../resources/pyodide", file.name)), extra],
  });
  assert.equal(checked.files.filter(file => file.verified).length, 5);
  assert.deepEqual(checked.unmatched, ["extra.txt"]);
});
test("A selected archive changed after validation is refused before any environment is installed", async t => {
  const { root, runtimes, files } = await fixture(t),
    plan = await files.create("sql"),
    row = files.get(plan.token, "sql").files[0],
    source = path.join(root, "selected.tgz");
  await fs.writeFile(source, "initial");
  // Model a completed verification; install must independently read the file.
  Object.assign(row, {
    path: source,
    verified: true,
    localHash: {
      algorithm: "sha256",
      value: require("node:crypto").createHash("sha256").update("initial").digest("hex"),
    },
  });
  await fs.writeFile(source, "changed");
  await assert.rejects(files.install({ language: "sql", token: plan.token }), /已选文件发生变化/);
  assert.equal(row.verified, false);
  assert.deepEqual((await runtimes.state("sql")).installed, []);
  assert.deepEqual(await fs.readdir(path.join(runtimes.root, "staging")), []);
});

test("Local file validation can be cancelled without enabling or leaving a partially verified selection", async t => {
  const { root, runtimes, files } = await fixture(t),
    plan = await files.create("sql"),
    source = path.join(root, "large.tgz");
  await fs.writeFile(source, Buffer.alloc(1024 * 1024));
  runtimes.downloads.publish = state => {
    if (state.status === "running" && state.phase === "校验文件") {
      runtimes.downloads.cancel(state.scope, state.id);
    }
  };
  await assert.rejects(
    files.select({ language: "sql", token: plan.token, id: plan.files[0].id, paths: [source] }),
    error => error.code === "DOWNLOAD_CANCELLED",
  );
  assert.equal(files.get(plan.token, "sql").files[0].verified, false);
  assert.deepEqual((await runtimes.state("sql")).installed, []);
  assert.equal(runtimes.downloads.state("runtime:sql").status, "cancelled");
});

test("Environment version detection reads the archive metadata offline, not its filename, and refuses another language", async t => {
  const { root, files } = await fixture(t);
  const metadata = JSON.stringify({ name: "sql.js", version: "1.14.1", dependencies: {} }),
    header = Buffer.alloc(512);
  header.write("package/package.json");
  header.write("0000644\0", 100);
  header.write(Buffer.byteLength(metadata).toString(8).padStart(11, "0") + "\0", 124);
  header.write("0", 156);
  const bytes = require("node:zlib").gzipSync(
      Buffer.concat([
        header,
        Buffer.from(metadata),
        Buffer.alloc((512 - Buffer.byteLength(metadata) % 512) % 512),
        Buffer.alloc(1024),
      ]),
    ),
    source = path.join(root, "renamed-package.tgz");
  await fs.writeFile(source, bytes);
  const previous = global.fetch;
  global.fetch = async () => {
    throw Error("unexpected network");
  };
  t.after(() => global.fetch = previous);
  const plan = await files.identify("sql", source);
  assert.equal(plan.version, "1.14.1");
  assert.equal(plan.files[0].verified, true);
  assert.equal(plan.files[0].path, source);
  await assert.rejects(files.identify("lua", source), /wasmoon/);
  assert.deepEqual(await fs.readdir(path.join(files.runtimes.root, "staging")), []);
  const python = await files.identify("python", path.resolve(__dirname, "../resources/pyodide/pyodide.mjs"));
  assert.equal(python.version, "314.0.7");
  assert.equal(python.files.find(file => file.id === "pyodide.mjs").verified, true);
});
test("SDK file servers accept a directory base and refuse single compiler files", () => {
  const { assetMirror } = require("../electron/browser-runtimes.cjs");
  assert.equal(assetMirror("https://mirror.example.com/teavm"), "https://mirror.example.com/teavm/");
  assert.equal(assetMirror(""), "");
  assert.throws(() => assetMirror("https://mirror.example.com/compiler.wasm"), /单个文件/);
});
