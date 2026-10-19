const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { gunzipSync } = require("node:zlib");
const semver = require("semver");
const { readDownload } = require("./download-tasks.cjs");
const packageName = value =>
  typeof value === "string" && /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(value) && value.length < 150;
const versionName = value =>
  typeof value === "string" && !!semver.valid(value) && !value.includes("/") && value.length < 60;
const registry = "https://registry.npmjs.org/";
function registryURL(value = registry) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw Error("请输入 HTTPS npm 镜像地址，不需要填写包名或版本。");
  }
  url.pathname = url.pathname.replace(/\/*$/, "/");
  return url.href;
}
async function responseBytes(url, limit, integrity, job, name = "安装资源") {
  let target = new URL(url), response;
  for (let redirects = 0; redirects <= 5; redirects++) {
    job?.check();
    if (target.protocol !== "https:" || target.username || target.password) {
      throw Error("安装资源必须使用 HTTPS 地址。");
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await fetch(target, {
          redirect: "manual",
          signal: AbortSignal.any([AbortSignal.timeout(120000), ...(job ? [job.controller.signal] : [])]),
          headers: { Accept: "application/vnd.npm.install-v1+json" },
        });
        if ([429, 502, 503, 504].includes(response.status) && attempt < 2) {
          await response.body?.cancel();
          const retryAfter = Number(response.headers.get("retry-after"));
          const wait = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(2000, retryAfter * 1000)
            : 400 * (2 ** attempt);
          await require("node:timers/promises").setTimeout(wait, undefined, { signal: job?.controller.signal });
          continue;
        }
        break;
      } catch (e) {
        job?.check();
        if (attempt === 2) throw Error("无法连接下载源 " + target.hostname + "，请检查网络或更换镜像。", { cause: e });
      }
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      if (redirects === 5) throw Error("下载源重定向次数过多。");
      target = new URL(response.headers.get("location"), target);
      continue;
    }
    break;
  }
  if (!response.ok) throw Error("下载失败（" + response.status + "）：" + target.hostname);
  const bytes = await readDownload(response, limit, job, name);
  if (integrity) {
    const [algorithm, expected] = integrity.split("-");
    if (
      !["sha512", "sha256", "sha1"].includes(algorithm)
      || crypto.createHash(algorithm).update(bytes).digest("base64") !== expected
    ) throw Error("安装资源校验失败。");
  }
  return bytes;
}
// npm archives are data: never run lifecycle scripts, executable files, links,
// or package hooks. Validate TAR paths before creating any destination file.
async function unpack(bytes, directory, job) {
  job?.phase("解压文件");
  const tar = gunzipSync(bytes, { maxOutputLength: 300 * 1024 * 1024 });
  let offset = 0, count = 0, rootName;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (header.every(v => v === 0)) break;
    job?.check();
    const str = (a, b) => header.subarray(a, b).toString().split("\0")[0];
    const raw = [str(345, 500), str(0, 100)].filter(Boolean).join("/"),
      size = parseInt(str(124, 136).trim() || "0", 8),
      type = str(156, 157);
    if (!Number.isSafeInteger(size) || size < 0 || offset + size > tar.length) throw Error("npm 归档损坏。");
    if (["x", "g", "L", "K"].includes(type)) throw Error("npm 归档含不支持的扩展路径。");
    const parts = raw.split("/").filter(Boolean);
    if (
      raw.startsWith("/") || !parts.length || parts.length > 30 || parts.some(p =>
        p === "." || p === ".." || p.length > 200 || /[. ]$/.test(p)
        || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p) || /[<>|?*\\:\x00-\x1f]/.test(p)
      )
    ) throw Error("npm 归档路径无效：" + raw);
    const first = parts.shift();
    rootName ||= first;
    if (first !== rootName) throw Error("npm 归档包含多个根目录。");
    if (++count > 30000) throw Error("npm 归档文件过多。");
    if (type === "5") { if (parts.length) await fs.mkdir(path.join(directory, ...parts), { recursive: true }); }
    else if (type === "" || type === "0") {
      if (!parts.length) throw Error("npm 归档路径无效。");
      const file = path.join(directory, ...parts);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, tar.subarray(offset, offset + size), { flag: "wx" });
    } else throw Error("npm 归档不允许链接或设备文件。");
    offset += Math.ceil(size / 512) * 512;
  }
}
class NpmStore {
  constructor(root, options = {}) {
    this.root = root;
    this.options = options;
    this.cache = new Map();
    this.cacheBytes = 0;
    this.queue = Promise.resolve();
  }
  useRegistry(value) {
    const next = registryURL(value);
    if (this.registry !== next) {
      this.clear();
      this.registry = next;
    }
    return next;
  }
  clear() {
    this.cache.clear();
    this.cacheBytes = 0;
  }
  forget(name) {
    const previous = this.cache.get(name);
    if (previous) {
      this.cacheBytes -= previous.size;
      this.cache.delete(name);
    }
  }
  async metadata(name) {
    this.options.job?.check();
    if (!packageName(name)) throw Error("npm 包名无效。");
    if (this.cache.has(name)) return this.cache.get(name).data;
    const bytes = await responseBytes(
        (this.registry || registry) + encodeURIComponent(name),
        20 * 1024 * 1024,
        undefined,
        this.options.job,
        name + " 清单",
      ),
      data = JSON.parse(bytes);
    this.cache.set(name, { data, size: bytes.length });
    this.cacheBytes += bytes.length;
    while (this.cache.size > 32 || this.cacheBytes > 12 * 1024 * 1024) this.forget(this.cache.keys().next().value);
    return data;
  }
  async versions(name) {
    this.forget(name);
    const data = await this.metadata(name);
    return Object.keys(data.versions || {}).filter(versionName).filter(v => !semver.prerelease(v)).sort(
      semver.rcompare,
    );
  }
  async installTree(name, version, directory, state = { count: 0, bytes: 0, stack: [] }) {
    if (!packageName(name) || !versionName(version)) throw Error("npm 包名或版本无效。");
    if (++state.count > 200 || state.stack.length > 16) throw Error("依赖数量或层级超过限制。");
    const data = await this.metadata(name), info = data.versions?.[version];
    if (!info?.dist?.integrity) throw Error("npm 包未提供校验信息。");
    this.options.progress?.(name + " " + version);
    const tarball = new URL(info.dist.tarball), source = new URL(this.registry || registry);
    if (tarball.hostname === "registry.npmjs.org" && source.href !== registry) {
      tarball.host = source.host;
      tarball.pathname = source.pathname.replace(/\/$/, "") + tarball.pathname;
    }
    const bytes = await responseBytes(
      tarball.href,
      120 * 1024 * 1024,
      info.dist.integrity,
      this.options.job,
      name + " " + version,
    );
    state.bytes += bytes.length;
    if (state.bytes > 300 * 1024 * 1024) throw Error("依赖下载超过 300 MB。");
    this.options.job?.check();
    await fs.mkdir(directory, { recursive: true });
    await unpack(bytes, directory, this.options.job);
    const actual = JSON.parse(await fs.readFile(path.join(directory, "package.json"), "utf8"));
    if (actual.name !== name || actual.version !== version) throw Error("npm 包内容与版本不匹配。");
    const dependencies = { ...info.dependencies, ...info.optionalDependencies };
    const parents = [...state.stack, { name, version, directory }];
    for (const [dependency, range] of Object.entries(dependencies)) {
      if (!packageName(dependency) || !semver.validRange(range)) {
        throw Error("依赖不是受支持的 npm 版本：" + dependency);
      }
      if (parents.some(p => p.name === dependency && semver.satisfies(p.version, range))) continue;
      const meta = await this.metadata(dependency),
        selected = this.options.overrides?.[dependency]
          || semver.maxSatisfying(Object.keys(meta.versions || {}), range);
      if (!selected || !semver.satisfies(selected, range)) throw Error("找不到依赖：" + dependency);
      const previous = state.stack;
      state.stack = parents;
      try {
        await this.installTree(
          dependency,
          selected,
          path.join(directory, "node_modules", ...dependency.split("/")),
          state,
        );
      } finally {
        state.stack = previous;
      }
    }
    return actual;
  }
  serialize(action) {
    const task = this.queue.then(action);
    this.queue = task.catch(() => {});
    return task;
  }
}
module.exports = { NpmStore, responseBytes, unpack, packageName, versionName, registryURL };
