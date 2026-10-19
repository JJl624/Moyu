const fs = require("node:fs/promises"), path = require("node:path"), semver = require("semver");
async function readPackage(directory) {
  const file = path.join(directory, "package.json"), stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) {
    throw Error("package.json 必须是普通文件，且不超过 4 MB");
  }
  return JSON.parse(await fs.readFile(file, "utf8"));
}
async function packageInfo(kind, source) {
  const stat = await fs.lstat(path.join(source, "package.json"));
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) {
    throw Error("package.json 无效");
  }
  const pkg = await readPackage(source);
  const names = {
    clang: "@live-codes/clang-wasm",
    sql: "sql.js",
    lua: "wasmoon",
    bash: "@everruns/bashkit-wasm",
  };
  let version = pkg.version, minimum = { clang: "0.3.0", sql: "1.10.0", lua: "1.15.0", bash: "0.18.0" }[kind];
  if (kind === "ruby") {
    const match = /^@ruby\/(4\.0|3\.4|3\.3|3\.2)-wasm-wasi$/.exec(pkg.name);
    if (
      !match || !semver.valid(version) || semver.prerelease(version)
      || semver.lt(version, match[1] === "4.0" ? "2.10.0" : "2.7.0")
    ) throw Error("请选择支持的 ruby+stdlib.wasm npm 包目录");
    if (match[1] !== "4.0") version = match[1] + ".0-" + version;
  } else if (
    pkg.name !== names[kind] || !semver.valid(version) || semver.lt(version, minimum)
    || semver.prerelease(version)
  ) throw Error("请选择 " + (names[kind] || "支持的环境") + " 的兼容 npm 包目录");
  const files = kind === "clang"
    ? [
      "assets/runtime-manifest.v1.json",
      "assets/bin/clang.wasm.gz",
      "assets/bin/lld.wasm.gz",
      "assets/bin/memfs.wasm.gz",
      "assets/bin/sysroot.tar.gz",
    ]
    : kind === "sql"
    ? ["dist/sql-wasm.wasm"]
    : kind === "lua"
    ? ["dist/glue.wasm"]
    : kind === "ruby"
    ? ["dist/ruby+stdlib.wasm"]
    : ["bashkit_wasm_bg.wasm"];
  return { pkg, version, files: ["package.json", ...files] };
}
function localInstaller(
  source,
  primary,
  job,
  context = { checked: new Set(), stack: [], copies: 0, budget: { count: 0, total: 0 } },
) {
  const checked = context.checked;
  const resolve = async (name) => {
    if (name === primary.name) return source;
    const candidates = [path.join(source, "node_modules", ...name.split("/"))];
    // An npm package can also be selected from an existing node_modules tree.
    let current = source;
    for (let i = 0; i < 4; i++) {
      current = path.dirname(current);
      if (path.basename(current) === "node_modules") candidates.push(path.join(current, ...name.split("/")));
    }
    for (const candidate of candidates) {
      if (await fs.lstat(path.join(candidate, "package.json")).catch(() => null)) return candidate;
    }
    throw Error("缺少本地依赖 " + name + "，请导入包含 node_modules 的完整 npm 包目录");
  };
  const verify = async (directory) => {
    if (checked.has(directory)) return;
    checked.add(directory);
    if (checked.size > 200) throw Error("本地依赖超过 200 个");
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error("本地依赖不能使用链接");
    const pkg = await readPackage(directory);
    for (const [name, range] of Object.entries(pkg.dependencies || {})) {
      if (!require("./npm-store.cjs").packageName(name) || !semver.validRange(range)) {
        throw Error("不支持的依赖声明：" + name);
      }
      let dependency = path.join(directory, "node_modules", ...name.split("/"));
      if (!await fs.stat(path.join(dependency, "package.json")).catch(() => null)) {
        dependency = await resolve(name);
      }
      const info = await readPackage(dependency);
      if (info.name !== name || !semver.satisfies(info.version, range)) {
        throw Error("本地依赖版本不匹配：" + name);
      }
      await verify(dependency);
    }
  };
  const install = async (name, version, target) => {
    if (++context.copies > 200 || context.stack.length > 16) throw Error("本地依赖数量或层级超过限制");
    const directory = await resolve(name), pkg = await readPackage(directory);
    if (pkg.name !== name || pkg.version !== version) {
      throw Error("本地包版本不匹配：" + name + " " + version);
    }
    await verify(directory);
    await require("./local-imports.cjs").copyDirectory(directory, target, job, context.budget);
    // Hoisted dependencies must be copied too; the adapter only resolves files
    // inside its new runtime directory, never the original host installation.
    for (const [dependency] of Object.entries(pkg.dependencies || {})) {
      if (
        !await fs.stat(path.join(target, "node_modules", ...dependency.split("/"), "package.json")).catch(
          () => null
        )
      ) {
        const actual = await resolve(dependency), info = await readPackage(actual);
        if (
          [...context.stack, { name, version }].some(parent =>
            parent.name === dependency && parent.version === info.version
          )
        ) continue;
        context.stack.push({ name, version });
        try {
          await localInstaller(actual, info, job, context)(
            dependency,
            info.version,
            path.join(target, "node_modules", ...dependency.split("/")),
          );
        } finally {
          context.stack.pop();
        }
      }
    }
    return pkg;
  };
  install.validate = async (name = primary.name, version = primary.version) => {
    const directory = await resolve(name), pkg = await readPackage(directory);
    if (pkg.name !== name || pkg.version !== version) throw Error("本地包版本不匹配：" + name);
    return verify(directory);
  };
  install.resolve = resolve;
  return install;
}
module.exports = { packageInfo, localInstaller };
