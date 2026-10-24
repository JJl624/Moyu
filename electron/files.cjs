const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { hash, fault } = require("./vault.cjs");
const { DATA_FOLDER } = require("./vault-paths.cjs");
const eligible = (p) =>
  p
    .split("/")
    .every(
      (s) =>
        s
        && !s.startsWith(".")
        && s !== "node_modules" && s !== DATA_FOLDER
        && !/[<>:"\\|?*\x00-\x1f]/.test(s)
        && !/[. ]$/.test(s)
        && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(s),
    );
async function internal(vault, name) {
  let dir = vault.dataDirectory || path.join(vault.root, DATA_FOLDER);
  await fs.mkdir(dir, { recursive: true });
  if ((await fs.lstat(dir)).isSymbolicLink()) throw fault("应用数据目录不能是符号链接。");
  for (const part of name.split("/").filter(Boolean)) {
    dir = path.join(dir, part);
    await fs.mkdir(dir).catch((e) => {
      if (e.code !== "EEXIST") throw e;
    });
    const stat = await fs.lstat(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw fault("内部数据目录不能是符号链接或文件。");
    }
  }
  return dir;
}
// File scanners can briefly hold a newly written file or runtime directory.
async function renameWithRetry(source, target) {
  for (let attempt = 0;; attempt++) {
    try {
      return await fs.rename(source, target);
    } catch (e) {
      if (!["EPERM", "EBUSY", "EACCES"].includes(e.code) || attempt >= 6) throw e;
      await new Promise(resolve => setTimeout(resolve, Math.min(500, 20 * 2 ** attempt)));
    }
  }
}
async function atomic(target, bytes, { flush = true } = {}) {
  const temp = path.join(
    path.dirname(target),
    "moyu-tmp-" + crypto.randomUUID() + ".tmp",
  );
  try {
    await fs.writeFile(temp, bytes, { flush });
    await renameWithRetry(temp, target);
    if (flush && process.platform !== "win32") {
      const directory = await fs.open(path.dirname(target), "r");
      try {
        await directory.sync().catch(error => {
          if (!["EINVAL", "ENOTSUP", "EBADF"].includes(error.code)) throw error;
        });
      } finally {
        await directory.close();
      }
    }
  } finally {
    await fs.unlink(temp).catch(() => {});
  }
}
// Configuration writes are serialized by their owners. Equal content must not
// create a temporary file, update timestamps, or trigger filesystem watchers.
async function atomicIfChanged(target, bytes) {
  const next = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const previous = await fs.readFile(target).catch(e => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
  if (previous?.equals(next)) return false;
  await atomic(target, next);
  return true;
}
async function snapshot(vault, relative) {
  if (!eligible(relative)) throw fault("文件名称不支持跨平台同步。");
  const target = await vault.resolve(relative, true);
  let ancestor = vault.root;
  for (const part of relative.split("/")) {
    ancestor = path.join(ancestor, part);
    const stat = await fs.lstat(ancestor).catch((e) => {
      if (e.code !== "ENOENT") throw e;
      return null;
    });
    if (stat?.isSymbolicLink()) {
      throw fault("不操作符号链接：" + relative);
    }
    if (!stat) break;
  }
  try {
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw fault("只能操作普通文件。");
    }
    const bytes = await fs.readFile(target);
    return {
      path: relative,
      bytes,
      version: hash(bytes),
      updated: stat.mtimeMs,
    };
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
async function scan(vault) {
  const result = {};
  let total = 0;
  async function visit(dir, prefix = "", depth = 0) {
    if (depth > 30) throw fault("文件夹层级超过 30 层。");
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (!eligible(relative) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await visit(await vault.resolve(relative), relative + "/", depth + 1);
      } else if (entry.isFile()) {
        if (Object.keys(result).length >= 10000) {
          throw fault("单次同步最多支持 10000 个文件。");
        }
        result[relative] = await snapshot(vault, relative);
        total += result[relative].bytes.length;
        if (total > 256 * 1024 * 1024) {
          throw fault("单次同步内容超过 256 MB，请拆分工作空间。");
        }
      }
    }
  }
  await visit(vault.root);
  return result;
}
async function recovery(vault, relative, bytes, label = "local") {
  const dir = await internal(vault, vault.dataDirectory ? "conflicts" : "recovery");
  const extension = path.extname(relative),
    stem = Array.from(path.basename(relative, extension)).slice(0, 36).join(""),
    id = hash(Buffer.concat([Buffer.from(relative + "\n" + label + "\n"), bytes])).slice(0, 24),
    name = `${stem}-${label === "remote" ? "远端冲突" : "本地副本"}-${id}${
      Array.from(extension).slice(0, 20).join("")
    }`;
  // The same remote revision needs one recoverable copy, including failed retries.
  for (
    const [target, content] of [
      [path.join(dir, name), bytes],
      [path.join(dir, name + ".json"), JSON.stringify({ path: relative, label, time: Date.now() })],
    ]
  ) {
    await fs.writeFile(target, content, { flag: "wx" }).catch(e => {
      if (e.code !== "EEXIST") throw e;
    });
  }
}
// Called inside the vault mutation queue; expected=null means the file must not exist.
async function replace(vault, relative, bytes, expected) {
  const current = await snapshot(vault, relative);
  if ((current?.version ?? null) !== expected) {
    throw fault("本地文件在操作过程中发生变化：" + relative, "CONFLICT");
  }
  const target = await vault.resolve(relative, true);
  if (bytes === null) {
    if (current) await fs.unlink(target);
    return null;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await vault.resolve(relative, true);
  await atomic(target, bytes);
  return snapshot(vault, relative);
}
module.exports = {
  eligible,
  internal,
  atomic,
  atomicIfChanged,
  renameWithRetry,
  snapshot,
  scan,
  recovery,
  replace,
};
