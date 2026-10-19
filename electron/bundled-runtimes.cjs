const fs = require("node:fs/promises");
const native = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { atomicIfChanged, renameWithRetry } = require("./files.cjs");
const jobs = new WeakMap();
function validPath(name) {
  return typeof name === "string" && name.length < 500 && !name.startsWith("/")
    && name.split("/").every(part => part && part !== "." && part !== ".." && !/[\\:\x00-\x1f]/.test(part));
}
async function copyVerified(source, target, expected) {
  const stat = await fs.lstat(source);
  if (
    !stat.isFile() || stat.isSymbolicLink() || !Number.isSafeInteger(expected.bytes) || expected.bytes < 0
    || expected.bytes > 128 * 1024 * 1024 || stat.size !== expected.bytes || !/^[a-f0-9]{64}$/.test(expected.sha256)
  ) throw Error("内置环境文件无效：" + path.basename(source));
  let bytes = 0;
  const hash = crypto.createHash("sha256");
  const verify = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > expected.bytes) return callback(Error("内置环境文件大小不符"));
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await fs.mkdir(path.dirname(target), { recursive: true });
  await pipeline(native.createReadStream(source), verify, native.createWriteStream(target, { flags: "wx" }));
  if (bytes !== expected.bytes || hash.digest("hex") !== expected.sha256) {
    throw Error("内置环境校验失败：" + path.basename(source));
  }
}
async function initialize(manager, bundleRoot) {
  const raw = await fs.readFile(path.join(bundleRoot, "index.json"), "utf8").catch(error => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (raw === null) return;
  const index = JSON.parse(raw);
  if (index.version !== 1 || !Array.isArray(index.runtimes) || index.runtimes.length > 20) {
    throw Error("内置环境清单无效");
  }
  const seen = new Set();
  for (const item of index.runtimes) {
    if (
      !manager.definition(item.kind) || item.version !== manager.definition(item.kind).recommended
      || seen.has(item.kind) || !item.files || Object.keys(item.files).length > 4096 || !item.files["manifest.json"]
    ) throw Error("内置环境版本无效");
    seen.add(item.kind);
    const config = await manager.config(item.kind), target = manager.directory(item.kind, item.version);
    if (config.bundledVersion === item.version || config.bundledRemoved === item.version) continue;
    const exists = await fs.lstat(target).catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (exists) {
      if (!exists.isDirectory() || exists.isSymbolicLink()) throw Error("运行环境目录无效");
      const manifest = JSON.parse(await fs.readFile(path.join(target, "manifest.json"), "utf8"));
      if (manifest.kind !== item.kind || manifest.version !== item.version) throw Error("运行环境版本不符");
    } else {
      const stage = path.join(manager.root, item.kind, "staging", "bundled-" + crypto.randomUUID());
      await fs.mkdir(stage, { recursive: true });
      try {
        for (const [name, expected] of Object.entries(item.files)) {
          if (!validPath(name)) throw Error("内置环境路径无效");
          await copyVerified(
            path.join(bundleRoot, item.kind, item.version, ...name.split("/")),
            path.join(stage, ...name.split("/")),
            expected,
          );
        }
        const manifest = JSON.parse(await fs.readFile(path.join(stage, "manifest.json"), "utf8"));
        if (manifest.kind !== item.kind || manifest.version !== item.version) throw Error("内置环境内容不符");
        await fs.mkdir(path.dirname(target), { recursive: true });
        await renameWithRetry(stage, target);
      } finally {
        await fs.rm(stage, { recursive: true, force: true });
      }
    }
    config.bundledVersion = item.version;
    if (!config.selected) config.selected = item.version;
    config.versions = [...new Set([...config.versions, item.version])];
    await manager.write(item.kind, config);
  }
}
function initializeBundledRuntimes(manager, bundleRoot = path.join(__dirname, "../resources/bundled-runtimes")) {
  if (!jobs.has(manager)) {
    const task = initialize(manager, bundleRoot).catch(error => {
      jobs.delete(manager);
      throw error;
    });
    jobs.set(manager, task);
  }
  return jobs.get(manager);
}
module.exports = { initializeBundledRuntimes };
