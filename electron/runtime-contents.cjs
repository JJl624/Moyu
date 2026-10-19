const fs = require("node:fs/promises"), path = require("node:path"), semver = require("semver");
const { packageName } = require("./npm-store.cjs");
const receipts = require("../resources/manual-runtime-files.json"), browser = require("./browser-runtimes.cjs").catalog;
const { withDependencyIds } = require('./runtime-tree.cjs');

function packageURL(name, version, registry, tarball) {
  if (!packageName(name) || !semver.valid(version)) return "";
  const recorded = Object.values(receipts.packages).find(pkg => pkg.name === name && pkg.version === version)?.url;
  if (!tarball && !recorded) return "";
  const url = new URL(tarball || recorded);
  const source = new URL(registry || "https://registry.npmjs.org/");
  if (url.protocol !== "https:" || url.username || url.password) throw Error("包下载地址无效");
  if (url.hostname === "registry.npmjs.org") {
    url.host = source.host;
    url.pathname = source.pathname.replace(/\/$/, "") + url.pathname;
  }
  return url.href;
}
async function readPackage(directory) {
  const file = path.join(directory, "package.json"), stat = await fs.lstat(file).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) return null;
  return JSON.parse(await fs.readFile(file, "utf8"));
}
class RuntimeContents {
  constructor(manual) {
    this.manual = manual;
    this.catalog = new manual.constructor({ runtimes: manual.runtimes, python: manual.python });
    this.pythonNames = new Map();
  }
  async describe(language, version) {
    const manager = this.manual.manager(language), plan = await this.catalog.create(language, version);
    const config = await manager.config(language),
      directory = language === "python" ? manager.directory(plan.version) : manager.directory(language, plan.version);
    const installed = !!await fs.lstat(path.join(directory, "manifest.json")).catch(() => null);
    let runtime = plan.files.filter(row => row.type !== "npm" || !browser[language]);
    let formatter = plan.files.filter(row => row.type === "npm" && browser[language]);
    if (language === "python") {
      if (installed) {
        const manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8"));
        runtime = Object.entries(manifest.files || {}).map(([name, file]) => {
          const row = plan.files.find(row => row.name === name || row.aliases?.includes(name));
          return { name, ...file, url: row ? new URL(name, row.url).href : "" };
        });
      } else if (plan.version !== require("../resources/pyodide/manifest.json").version) {
        const loader = plan.files.find(row => row.id === "pyodide.mjs"), key = loader.url;
        let name = this.pythonNames.get(key);
        if (!name) {
          name = await this.manual.transfer(language, "读取下载清单", async job => {
            const bytes = await require("./npm-store.cjs").responseBytes(
              loader.url,
              4 * 1024 * 1024,
              null,
              job,
              "pyodide.mjs",
            );
            const source = Buffer.from(bytes).toString("utf8");
            if (require("./pyodide-version.cjs").pyodideVersion(source) !== plan.version) {
              throw Error("下载源的 Pyodide 版本不符");
            }
            return source.includes("pyodide.asm.js") ? "pyodide.asm.js" : "pyodide.asm.mjs";
          });
        }
        this.pythonNames.set(key, name);
        while (this.pythonNames.size > 8) this.pythonNames.delete(this.pythonNames.keys().next().value);
        runtime = runtime.map(row =>
          row.id === "pyodide.asm.mjs" ? { ...row, name, url: new URL(name, row.url).href } : row
        );
      }
    }
    if (installed && language !== "python") {
      const manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"), "utf8"));
      const packageRow = info => {
        const receipt = receipts.packages[info.name + '@' + info.version];
        return { id:'npm:'+info.name+'@'+info.version, type:'npm', package:info.name,
          name:receipt?.file || info.name.split('/').pop()+'-'+info.version+'.tgz', version:info.version,
          dependencies:info.dependencies || receipt?.dependencies || {}, optionalDependencies:info.optionalDependencies,
          url:packageURL(info.name,info.version,config.registry,manager.npm?.cache.get(info.name)?.data.versions?.[info.version]?.dist?.tarball),purpose:info.description };
      };
      const packages = (manifest.bundledPackages || []).filter(info => packageName(info.name) && semver.valid(info.version)).map(packageRow);
      const visit = async (folder, depth = 0) => {
        if (depth > 16 || packages.length >= 200) throw Error("环境依赖过多");
        const stat = await fs.lstat(folder).catch(() => null);
        if (!stat?.isDirectory() || stat.isSymbolicLink()) return;
        const relative = path.relative(await fs.realpath(directory), await fs.realpath(folder));
        if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) return;
        const info = await readPackage(folder);
        if (!info || !packageName(info.name) || !semver.valid(info.version)) return;
        packages.push(packageRow(info));
        for (const name of Object.keys({ ...info.dependencies, ...info.optionalDependencies })) {
          if (packageName(name)) await visit(path.join(folder, "node_modules", ...name.split("/")), depth + 1);
        }
      };
      if (browser[language]) {
        await visit(path.join(directory, "formatter"));
        if (language === "java") await visit(path.join(directory, "node_modules/prettier"));
        if(packages.length)formatter = packages;
      } else {
        const definition = manager.definition(language);
        let name = definition.package;
        if (language === "ruby") name = require("./ruby-versions.cjs").rubyVersion(plan.version).package;
        await visit(path.join(directory, "node_modules", ...name.split("/")));
        if(packages.length)runtime = packages;
      }
    } else if (
      language !== "python" && !browser[language] && plan.version !== manager.definition(language).recommended
    ) {
      runtime = await this.manual.transfer(language, "读取下载清单", async job => {
        manager.npm.useRegistry(config.registry);
        const result = [], seen = new Set();
        const visit = async (name, requested, parents = []) => {
          job.check();
          if (result.length >= 200 || parents.length > 16) throw Error("环境依赖过多");
          const metadata = await manager.npm.metadata(name),
            selected = semver.valid(requested) || semver.maxSatisfying(Object.keys(metadata.versions || {}), requested);
          const info = metadata.versions?.[selected];
          if (!info?.dist?.tarball) throw Error("缺少下载信息：" + name);
          const key = name + "@" + selected;
          if (seen.has(key)) return;
          seen.add(key);
          result.push({
            id:'npm:'+key,type:'npm',package:name,name:new URL(info.dist.tarball).pathname.split('/').pop(),
            version: selected,
            dependencies:info.dependencies,optionalDependencies:info.optionalDependencies,
            url: packageURL(name, selected, config.registry, info.dist.tarball),
            purpose: info.description,
          });
          const next = [...parents, { name, version: selected }];
          for (const [dependency, range] of Object.entries({ ...info.dependencies, ...info.optionalDependencies })) {
            if (!packageName(dependency) || !semver.validRange(range)) throw Error("不支持的依赖：" + dependency);
            if (!next.some(item => item.name === dependency && semver.satisfies(item.version, range))) {
              await visit(dependency, manager.npm.options.overrides?.[dependency] || range, next);
            }
          }
        };
        for (const row of plan.files) {
          if (row.type === "npm") {
            await visit(row.package, row.version);
          }
        }
        return result;
      });
    }
    const unique = rows => [...new Map(rows.map(row => [row.id || row.name + "@" + (row.version || ""), row])).values()];
    const groups = [{ title: browser[language] ? "编译器与标准库" : "运行环境与依赖", files: withDependencyIds(unique(runtime)) }];
    if (formatter.length) groups.push({ title: "格式化插件与依赖", files: withDependencyIds(unique(formatter)) });
    else if (["clang", "sql", "lua"].includes(language)) {
      groups.push({
        title: "格式化工具（内置）",
        files: [{ name: { clang: "clang-format.wasm", sql: "sql.wasm", lua: "stylua.wasm" }[language], builtin: true }],
      });
    }
    return { language, version: plan.version, installed, groups };
  }
}
module.exports = { RuntimeContents, packageURL };
