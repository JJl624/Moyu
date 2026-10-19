const fs = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  semver = require("semver");
const receipts = require("../resources/manual-runtime-files.json"),
  browser = require("./browser-runtimes.cjs").catalog;
const { unpack, versionName, packageName } = require("./npm-store.cjs");
const { copyDirectory } = require("./local-imports.cjs");
const { withDependencyIds } = require('./runtime-tree.cjs');
const cleanPlan = plan => ({
  token: plan.token,
  language: plan.language,
  version: plan.version,
  unmatched: plan.unmatched,
  files: withDependencyIds(plan.files).map(({ directory, localHash, sourceURL, ...file }) => file),
});
async function digest(file, job, algorithm = "sha256") {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 120 * 1024 * 1024) {
    throw Error("请选择不超过 120 MB 的普通文件");
  }
  job.file(path.basename(file), stat.size);
  job.phase("校验文件");
  const hash = crypto.createHash(algorithm);
  let bytes = 0;
  for await (const chunk of require("node:fs").createReadStream(file, { signal: job.controller.signal })) {
    job.check();
    hash.update(chunk);
    job.advance(bytes += chunk.length);
  }
  return { hash: hash.digest(), size: stat.size };
}
class ManualRuntimeFiles {
  constructor({ runtimes, python }) {
    this.runtimes = runtimes;
    this.python = python;
    this.plans = new Map();
  }
  manager(language) {
    if (language !== "python" && !Object.hasOwn(require("./managed-runtimes.cjs").definitions, language)) {
      throw Error("不支持的语言环境");
    }
    return language === "python" ? this.python : this.runtimes;
  }
  transfer(language, label, action) {
    const manager = this.manager(language);
    return language === "python"
      ? manager.transfer(label, () => action(manager.task))
      : manager.transfer(language, label, action);
  }
  get(token, language) {
    const plan = this.plans.get(token);
    if (!plan || plan.language !== language) throw Error("文件清单已失效，请重新选择");
    return plan;
  }
  async create(language, version, token) {
    const manager = this.manager(language);
    if (language !== "python" && !manager.definition(language)) throw Error("不支持的语言环境");
    version = version
      || (language === "python"
        ? require("../resources/pyodide/manifest.json").version
        : manager.definition(language).recommended);
    if (!versionName(version)) throw Error("环境版本无效");
    if (language === "python") manager.version(version);
    if (browser[language] && version !== browser[language].version) {
      throw Error("请选择当前配套的运行环境版本");
    }
    let plan = token && this.plans.get(token);
    if (!plan || plan.language !== language || plan.version !== version) {
      plan = { token: crypto.randomUUID(), language, version, files: [] };
      if (language === "python") {
        const manifest = require("../resources/pyodide/manifest.json");
        for (
          const name of [
            "pyodide.mjs",
            "pyodide.asm.mjs",
            "pyodide.asm.wasm",
            "python_stdlib.zip",
            "pyodide-lock.json",
          ]
        ) {
          const item = manifest.version === version ? manifest.files[name] : null;
          plan.files.push({
            id: name,
            name,
            type: "python",
            aliases: name === "pyodide.asm.mjs" ? ["pyodide.asm.mjs", "pyodide.asm.js"] : undefined,
            ...item,
          });
        }
      } else if (browser[language]) {
        if (language === "csharp") {
          plan.files.push({
            id: "csharp-bundle",
            name: "dist 文件夹（包含 _framework）",
            type: "bundle",
            aliases: ["roslynweb-source-and-wasm.zip"],
            url: "",
            projectURL: "https://github.com/wieslawsoltes/RoslynWeb",
            requiredFiles: browser.csharp.files.map(file => ({
              name: file.name,
              bytes: file.bytes,
              url: new URL(file.name, browser.csharp.base).href,
            })),
          });
        } else {for (const file of browser[language].files) {
            plan.files.push({ id: file.name, name: file.name, type: "asset", ...file });
          }}
        for (const key of receipts.kinds[language]) this.addPackage(plan, receipts.packages[key]);
      } else {
        const defaults = manager.definition(language);
        if (version === defaults.recommended) {
          for (const key of receipts.kinds[language]) this.addPackage(plan, receipts.packages[key]);
        } else {
          const ruby = language === "ruby" ? require("./ruby-versions.cjs").rubyVersion(version) : null;
          this.addPackage(plan, { name: ruby?.package || defaults.package, version: ruby?.build || version });
          if (ruby) this.addPackage(plan, { name: "@ruby/wasm-wasi", version: ruby.build });
        }
      }
      this.plans.set(plan.token, plan);
      while (this.plans.size > 16) this.plans.delete(this.plans.keys().next().value);
    }
    const config = await manager.config(language);
    for (const file of plan.files) {
      if (file.type === "asset") {
        file.url = new URL(file.name, config.assetMirror || browser[language].base).href;
      } else if (file.type === "bundle") {
        for (const item of file.requiredFiles) {
          item.url = new URL(item.name, config.assetMirror || browser[language].base).href;
        }
        continue;
      } else if (file.type === "python") {
        const mirror = config.mirrors?.[config.mirror || 0];
        file.url = mirror
          ? new URL(
            (mirror.layout === "cdn" ? "v" + version + "/full/" : version + "/") + file.name,
            mirror.base,
          ).href
          : "https://cdn.jsdelivr.net/pyodide/v" + version + "/full/" + file.name;
      } else {
        const recorded = receipts.packages[file.package + "@" + file.version]?.url;
        const cached = manager.npm?.cache.get(file.package)?.data.versions?.[file.version]?.dist?.tarball;
        file.sourceURL ||= file.url || recorded || cached;
        if (!semver.valid(file.version) || !file.sourceURL) {
          file.url = "";
          file.sourcePage = "https://www.npmjs.com/package/" + file.package;
          continue;
        }
        delete file.sourcePage;
        const url = new URL(file.sourceURL),
          mirror = new URL(config.registry || "https://registry.npmjs.org/");
        if (url.hostname === "registry.npmjs.org") {
          url.host = mirror.host;
          url.pathname = mirror.pathname.replace(/\/$/, "") + url.pathname;
        }
        file.url = url.href;
      }
    }
    return cleanPlan(plan);
  }
  addPackage(plan, pkg) {
    const name = pkg.name, key = name + "@" + pkg.version;
    if (
      plan.files.some(file =>
        file.package === name && (file.version === pkg.version
          || semver.valid(file.version) && semver.validRange(pkg.version)
            && semver.satisfies(file.version, pkg.version))
      )
    ) return;
    if (!packageName(name) || plan.files.length >= 200) throw Error("环境包名无效或依赖超过 200 个");
    plan.files.push({
      id: "npm:" + key,
      type: "npm",
      package: name,
      version: pkg.version,
      name: pkg.file || name.split("/").pop() + "-" + pkg.version + ".tgz",
      integrity: pkg.integrity,
      url: pkg.url,
      metadata: pkg.dependencies ? { name, version: pkg.version, dependencies: pkg.dependencies } : undefined,
    });
  }
  async verify(plan, row, file, job) {
    if (row.type === "bundle") {
      const stat = await fs.lstat(file);
      if (stat.isSymbolicLink()) throw Error("运行文件不能使用链接");
      const bytes = await this.bundleAssets(file, stat.isDirectory(), job);
      row.path = file;
      row.directoryMode = stat.isDirectory();
      row.size = stat.isDirectory()
        ? Object.values(bytes).reduce((n, value) => n + value.length, 0)
        : stat.size;
      row.verified = true;
      row.error = "";
      row.localHash = { algorithm: "bundle", value: "catalog" };
      return;
    }
    job.phase("校验文件");
    const algorithm = row.integrity?.split("-")[0] || "sha256";
    if (!["sha256", "sha512", "sha1"].includes(algorithm)) throw Error("不支持的文件校验方式");
    const actual = await digest(file, job, algorithm);
    if (
      row.bytes !== undefined && row.bytes !== actual.size
      || row.sha256 && actual.hash.toString("hex") !== row.sha256
      || row.integrity && actual.hash.toString("base64") !== row.integrity.split("-")[1]
    ) throw Error("校验不匹配，请核对版本或重新下载");
    if (row.type === "npm" && !row.integrity) {
      const stage = path.join(this.manager(plan.language).root, "staging", "verify-" + crypto.randomUUID());
      await fs.mkdir(stage, { recursive: true });
      try {
        await unpack(await fs.readFile(file), stage, job);
        const stat = await fs.stat(path.join(stage, "package.json"));
        if (stat.size > 4 * 1024 * 1024) throw Error("package.json 超过 4 MB");
        const metadata = JSON.parse(await fs.readFile(path.join(stage, "package.json"), "utf8"));
        if (
          metadata.name !== row.package || !versionName(metadata.version)
          || !semver.satisfies(metadata.version, row.version)
        ) throw Error("包名或版本与清单不符");
        row.version = metadata.version;
        row.name = row.package.split("/").pop() + "-" + row.version + ".tgz";
        row.sourceURL = receipts.packages[row.package + "@" + row.version]?.url
          || this.manager(plan.language).npm?.cache.get(row.package)?.data.versions?.[row.version]?.dist?.tarball;
        row.url = "";
        delete row.sourcePage;
        row.metadata = metadata;
        for (const [name, range] of Object.entries(metadata.dependencies || {})) {
          if (!semver.validRange(range)) throw Error("不支持的依赖声明：" + name);
          const known = Object.values(receipts.packages).filter(pkg =>
            pkg.name === name && semver.satisfies(pkg.version, range)
          ).sort((a, b) => semver.rcompare(a.version, b.version))[0];
          this.addPackage(plan, known || { name, version: range });
        }
      } finally {
        await fs.rm(stage, { recursive: true, force: true });
      }
    }
    if (row.type === "python" && !row.sha256) {
      const handle = await fs.open(file, "r");
      try {
        const bytes = Buffer.alloc(8);
        await handle.read(bytes, 0, 8, 0);
        if (
          row.name.endsWith(".wasm") && bytes.subarray(0, 4).toString("hex") !== "0061736d"
          || row.name.endsWith(".zip") && bytes.subarray(0, 2).toString() !== "PK"
        ) throw Error("文件类型不符");
      } finally {
        await handle.close();
      }
      if (row.name === "pyodide-lock.json") {
        const catalog = JSON.parse(await fs.readFile(file, "utf8"));
        this.python.validateCatalog(catalog);
        if (catalog.info?.version && catalog.info.version !== plan.version) throw Error("Pyodide 版本不符");
      }
      if (row.name === "pyodide.mjs") {
        const code = await fs.readFile(file, "utf8");
        if (code.length < 1000 || !code.includes("loadPyodide") || code.slice(0, 100).includes("<!DOCTYPE")) {
          throw Error("Pyodide 加载器无效");
        }
      }
    }
    row.path = file;
    row.size = actual.size;
    row.verified = true;
    row.error = "";
    row.localHash = { algorithm, value: actual.hash.toString("hex") };
  }
  async bundleAssets(source, directory, job) {
    const result = {};
    if (directory) {
      for (const file of browser.csharp.files) {
        let target = path.join(source, file.name);
        if (!await fs.stat(target).catch(() => null)) target = path.join(source, path.basename(file.name));
        const check = await digest(target, job);
        if (check.size !== file.bytes || check.hash.toString("hex") !== file.sha256) {
          throw Error("运行文件不匹配：" + file.name);
        }
        result[file.name] = await fs.readFile(target);
      }
      return result;
    }
    const stat = await fs.lstat(source);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 120 * 1024 * 1024) {
      throw Error("运行压缩包需为不超过 120 MB 的普通 ZIP 文件");
    }
    let count = 0, total = 0, archive;
    try {
      archive = require("fflate").unzipSync(await fs.readFile(source), {
        filter: info => {
          job.check();
          const file = browser.csharp.files.find(file =>
            info.name === file.name || info.name.endsWith("/" + file.name)
          );
          if (!file) return false;
          if (
            ++count > browser.csharp.files.length || info.originalSize !== file.bytes
            || (total += info.originalSize) > 180 * 1024 * 1024
          ) throw Error("运行压缩包的文件清单不符");
          return true;
        },
      });
    } catch (error) {
      job.check();
      throw Error("运行压缩包无效：" + error.message);
    }
    for (const file of browser.csharp.files) {
      job.check();
      const entries = Object.entries(archive).filter(([name]) => name === file.name || name.endsWith("/" + file.name));
      if (entries.length !== 1) throw Error("压缩包缺少运行文件：" + file.name);
      const bytes = entries[0][1];
      job.file(file.name, bytes.length);
      job.phase("校验文件");
      job.advance(bytes.length);
      if (
        bytes.length !== file.bytes || crypto.createHash("sha256").update(bytes).digest("hex") !== file.sha256
      ) throw Error("运行文件不匹配：" + file.name);
      result[file.name] = bytes;
    }
    return result;
  }
  async identify(language, file, token) {
    if (browser[language]) throw Error("该环境使用当前配套版本");
    try {
      const metadata = await this.transfer(language, "识别环境版本", async job => {
        const check = await digest(file, job);
        if (language === "python") {
          if (check.size > 4 * 1024 * 1024) throw Error("Pyodide 加载器超过 4 MB");
          const source = await fs.readFile(file, "utf8"),
            version = require("./pyodide-version.cjs").pyodideVersion(source);
          return {
            version: this.python.version(version),
            id: "pyodide.mjs",
            asm: source.includes("pyodide.asm.js") ? "pyodide.asm.js" : "pyodide.asm.mjs",
          };
        }
        const stage = path.join(this.manager(language).root, "staging", "identify-" + crypto.randomUUID());
        await fs.mkdir(stage, { recursive: true });
        try {
          try {
            await unpack(await fs.readFile(file), stage, job);
          } catch (error) {
            job.check();
            throw Error("无法读取 npm 归档，请选择原始 .tgz 文件", { cause: error });
          }
          const info = await require("./local-runtime-package.cjs").packageInfo(language, stage);
          return { version: info.version, package: info.pkg.name };
        } finally {
          await fs.rm(stage, { recursive: true, force: true });
        }
      });
      const plan = await this.create(language, metadata.version, token),
        row = plan.files.find(row => metadata.id ? row.id === metadata.id : row.package === metadata.package);
      if (metadata.asm) {
        this.get(plan.token, language).files.find(row => row.id === "pyodide.asm.mjs").name = metadata.asm;
      }
      if (!row) throw Error("所选文件不是该语言的运行环境");
      return this.select({ language, token: plan.token, id: row.id, paths: [file] });
    } catch (error) {
      const previous = token && this.plans.get(token);
      if (previous?.language === language && error.code !== "DOWNLOAD_CANCELLED") {
        const row = previous.files.find(row =>
          row.id === "pyodide.mjs" || !!row.package && row.package === this.runtimes.definition(language)?.package
          || language === "ruby" && /^@ruby\/(?:4\.0|3\.4|3\.3|3\.2)-wasm-wasi$/.test(row.package || "")
        );
        if (row) {
          row.verified = false;
          row.path = file;
          row.error = error.message;
          delete row.size;
          delete row.localHash;
        }
      }
      throw error;
    }
  }
  async chooseFiles(language, paths, token) {
    let plan = token
      ? await this.create(language, this.get(token, language).version, token)
      : await this.create(language);
    let identified;
    if (!browser[language]) {
      const base = language === "python"
        ? "pyodide.mjs"
        : this.manager(language).definition(language).package.split("/").pop();
      const primary = paths.find(file =>
        language === "python" ? path.basename(file) === base : path.basename(file).startsWith(base + "-")
      )
        || (language === "ruby" && paths.find(file =>
          /^(?:4\.0|3\.4|3\.3|3\.2)-wasm-wasi-/.test(path.basename(file))
        ))
        || (paths.length === 1 && !plan.files.some(row => row.name === path.basename(paths[0])) ? paths[0] : null);
      if (primary) {
        plan = await this.identify(language, primary, plan.token);
        identified = primary;
      }
    }
    const remaining = paths.filter(file => file !== identified);
    return remaining.length ? this.select({ language, token: plan.token, paths: remaining }) : plan;
  }
  async chooseDirectory(language, directory) {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("请选择普通环境文件夹");
    let plan;
    if (language === "python") plan = await this.identify(language, path.join(directory, "pyodide.mjs"));
    else plan = await this.create(language);
    if (language === "csharp") {
      plan = await this.select({ language, token: plan.token, id: "csharp-bundle", paths: [directory] });
    }
    const paths = [];
    for (const row of plan.files) {
      const file = path.join(directory, row.name);
      if (await fs.lstat(file).catch(() => null)) paths.push(file);
      else {for (const alias of row.aliases || []) {
          const alternative = path.join(directory, alias);
          if (await fs.lstat(alternative).catch(() => null)) {
            paths.push(alternative);
            break;
          }
        }}
    }
    if (!paths.length && language === "csharp") return plan;
    if (!paths.length) throw Error("文件夹中没有所需的环境文件");
    return this.select({ language, token: plan.token, paths });
  }
  async select({ language, token, id, paths }) {
    const plan = this.get(token, language);
    return this.transfer(language, "验证环境文件", async job => {
      plan.unmatched = [];
      if (paths.length > 200) throw Error("最多选择 200 个文件");
      for (const file of paths) {
        const row = id
          ? plan.files.find(row => row.id === id)
          : plan.files.find(row =>
            row.name === path.basename(file) || row.aliases?.includes(path.basename(file))
            || row.type === "bundle" && /\.zip$/i.test(path.basename(file))
            || row.type === "npm" && !semver.valid(row.version)
              && path.basename(file).startsWith(row.package.split("/").pop() + "-")
          );
        if (!row) {
          plan.unmatched.push(path.basename(file));
          continue;
        }
        row.verified = false;
        row.path = file;
        row.error = "";
        try {
          await this.verify(plan, row, file, job);
        } catch (error) {
          job.check();
          row.error = error.message;
        }
      }
      job.commit();
      return this.create(language, plan.version, token);
    });
  }
  async install({ language, token }) {
    const plan = this.get(token, language);
    if (plan.files.some(row => !row.verified || row.error)) throw Error("请先选择并验证全部必需文件");
    // Stage inside application data; selection never executes package scripts.
    const root = path.join(this.manager(language).root, "staging", "import-" + crypto.randomUUID());
    try {
      await this.transfer(language, "导入环境文件", async job => {
        await fs.mkdir(root, { recursive: true });
        for (const row of plan.files) {
          job.phase("校验文件");
          if (row.type === "bundle") {
            let assets;
            try {
              assets = await this.bundleAssets(row.path, row.directoryMode, job);
            } catch (error) {
              row.verified = false;
              row.error = error.message;
              throw error;
            }
            for (const [name, bytes] of Object.entries(assets)) {
              const target = path.join(root, "assets", name);
              await fs.mkdir(path.dirname(target), { recursive: true });
              await fs.writeFile(target, bytes);
            }
            continue;
          }
          const check = await digest(row.path, job, row.localHash.algorithm);
          if (check.hash.toString("hex") !== row.localHash.value) {
            row.verified = false;
            row.error = "文件已变化，请重新选择";
            throw Error("已选文件发生变化，请重新验证：" + row.name);
          }
          if (row.type === "npm") {
            const target = path.join(root, "packages", crypto.randomUUID());
            await fs.mkdir(target, { recursive: true });
            await unpack(await fs.readFile(row.path), target, job);
            const info = JSON.parse(await fs.readFile(path.join(target, "package.json"), "utf8"));
            if (info.name !== row.package || info.version !== row.version) throw Error("包版本不符");
            row.directory = target;
            row.metadata = info;
          } else {
            const name = row.type === "python" && row.aliases?.includes(path.basename(row.path))
                ? path.basename(row.path)
                : row.name,
              target = path.join(root, "assets", ...name.split("/"));
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.copyFile(row.path, target);
          }
        }
        const budget = { count: 0, total: 0 };
        const assemble = async (row, target, stack = []) => {
          if (stack.length > 16) throw Error("依赖层级超过限制");
          await copyDirectory(row.directory, target, job, budget);
          for (const [name, range] of Object.entries(row.metadata.dependencies || {})) {
            if (stack.some(item => item.package === name && semver.satisfies(item.version, range))) continue;
            const child = plan.files.filter(file =>
              file.type === "npm" && file.package === name && semver.satisfies(file.version, range)
            ).sort((a, b) =>
              semver.rcompare(a.version, b.version)
            )[0];
            if (!child) throw Error("缺少依赖文件：" + name);
            const destination = path.join(target, "node_modules", ...name.split("/"));
            if (!await fs.stat(path.join(destination, "package.json")).catch(() => null)) {
              await assemble(child, destination, [...stack, row]);
            }
          }
        };
        const primary = language === "ruby"
          ? require("./ruby-versions.cjs").rubyVersion(plan.version).package
          : this.runtimes.definition(language)?.package;
        const roots = browser[language]
          ? [browser[language].formatter.name, ...(language === "java" ? ["prettier"] : [])]
          : [primary, ...(language === "ruby" ? ["@ruby/wasm-wasi"] : [])];
        for (
          const row of plan.files.filter(row => row.type === "npm" && roots.includes(row.package))
        ) {
          const destination = path.join(root, "npm/node_modules", ...row.package.split("/"));
          if (!await fs.stat(path.join(destination, "package.json")).catch(() => null)) {
            await assemble(row, destination);
          }
        }
        job.commit();
      });
      if (language === "python") {
        return await new (require("./local-imports.cjs").LocalImports)({ python: this.python }).pythonRuntime(
          path.join(root, "assets"),
          plan.version,
        );
      }
      if (browser[language]) {
        return await this.runtimes.install({ language, version: plan.version, manualSource: root });
      }
      const primary = language === "ruby"
        ? require("./ruby-versions.cjs").rubyVersion(plan.version).package
        : this.runtimes.definition(language).package;
      return await this.runtimes.install({
        language,
        version: plan.version,
        localSource: path.join(root, "npm/node_modules", ...primary.split("/")),
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
}
module.exports = { ManualRuntimeFiles, digest };
