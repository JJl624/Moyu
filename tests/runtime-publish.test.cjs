const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path");
const { renameWithRetry } = require("../electron/files.cjs");
test("Publishing an environment retries a transient Windows directory lock and moves the entire directory atomically", async t => {
  const root = await fs.mkdtemp(path.resolve(__dirname, "../../../work/runtime-publish-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "stage"), target = path.join(root, "runtime");
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, "asset.wasm"), "contents");
  const original = fs.rename;
  let attempts = 0;
  fs.rename = async (...args) => {
    if (++attempts <= 2) throw Object.assign(Error("temporarily locked"), { code: "EPERM" });
    return original(...args);
  };
  t.after(() => fs.rename = original);
  await renameWithRetry(source, target);
  assert.equal(attempts, 3);
  assert.equal(await fs.readFile(path.join(target, "asset.wasm"), "utf8"), "contents");
  await assert.rejects(fs.stat(source), { code: "ENOENT" });
});
test("Runtime publishing does not retry unrelated errors or report successful publication on failure", async t => {
  const original = fs.rename;
  let attempts = 0;
  fs.rename = async () => {
    attempts++;
    throw Object.assign(Error("cross-device move"), { code: "EXDEV" });
  };
  t.after(() => fs.rename = original);
  await assert.rejects(renameWithRetry("a", "b"), { code: "EXDEV" });
  assert.equal(attempts, 1);
});
