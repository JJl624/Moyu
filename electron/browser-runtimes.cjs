const fs = require("node:fs/promises"), path = require("node:path"), crypto = require("node:crypto");
const { responseBytes, registryURL } = require("./npm-store.cjs");
const catalog = require("../resources/browser-runtimes/catalog.json");
async function installBrowserRuntime(manager, kind, version, job, manualSource) {
  const receipt = catalog[kind];
  if (version !== receipt.version) throw Error("请选择可用版本。");
  const config = await manager.config(kind),
    target = manager.directory(kind, version),
    stage = path.join(manager.root, kind, "staging", crypto.randomUUID());
  if ((await manager.state(kind)).installed.some(v => v.version === version)) return manager.state(kind);
  await fs.mkdir(stage, { recursive: true });
  let published = false, registered = false;
  try {
    const base = config.assetMirror || receipt.base, files = {};
    for (const file of receipt.files) {
      const bytes = manualSource
        ? await fs.readFile(path.join(manualSource, "assets", file.name))
        : await responseBytes(new URL(file.name, base), Math.max(file.bytes, 1024), null, job, file.name);
      if (
        bytes.length !== file.bytes || crypto.createHash("sha256").update(bytes).digest("hex") !== file.sha256
      ) throw Error("运行环境校验失败：" + file.name + "。请检查镜像或刷新程序版本。");
      const name = kind + "/" + file.name;
      await fs.mkdir(path.dirname(path.join(stage, name)), { recursive: true });
      await fs.writeFile(path.join(stage, name), bytes);
      files[name] = { bytes: file.bytes, sha256: file.sha256 };
    }
    manager.npm.useRegistry(config.registry);
    const installTree = manualSource
      ? async (name, version, target) => {
        const source = path.join(manualSource, "npm/node_modules", ...name.split("/")),
          info = JSON.parse(await fs.readFile(path.join(source, "package.json"), "utf8"));
        if (info.name !== name || info.version !== version) throw Error("本地格式化工具版本不符");
        return require("./local-imports.cjs").copyDirectory(source, target, job);
      }
      : manager.npm.installTree.bind(manager.npm);
    const formatter = path.join(stage, "formatter");
    await installTree(receipt.formatter.name, receipt.formatter.version, formatter);
    if (kind === "csharp") {
      await fs.copyFile(path.join(formatter, "plugin.wasm"), path.join(stage, "formatter.wasm"));
    } else {
      await installTree("prettier", "3.6.2", path.join(stage, "node_modules", "prettier"));
      await require("./java-formatter.cjs").build(stage);
    }
    // esbuild runs outside Electron and cannot read app.asar virtual paths.
    // Copy only the adapter sources into this installation's staging folder.
    const adapter = path.join(stage, "adapter");
    await fs.mkdir(adapter, { recursive: true });
    for (
      const name of [
        kind + "-worker.mjs",
        ...(kind === "csharp" ? ["file-runtime.mjs", "run-files.mjs"] : []),
      ]
    ) await fs.copyFile(path.join(__dirname, "runner", name), path.join(adapter, name));
    if (kind === "java") {
      for (const name of ["managed-source.cjs", "clang-source.cjs"]) {
        await fs.copyFile(path.join(__dirname, name), path.join(stage, name));
      }
    }
    if (kind === "java") {
      await fs.copyFile(path.join(__dirname, "runner/run-files.mjs"), path.join(adapter, "run-files.mjs"));
    }
    await require("esbuild").build({
      entryPoints: [path.join(adapter, kind + "-worker.mjs")],
      outfile: path.join(stage, kind + "-runtime.mjs"),
      bundle: true,
      platform: "browser",
      format: "esm",
      target: "chrome144",
      minify: true,
      logLevel: "silent",
    });
    await fs.rm(adapter, { recursive: true, force: true });
    const licenseRoot = path.join(__dirname, "../resources/licenses"),
      notices = kind === "csharp"
        ? ["RoslynWeb-MIT.txt", "dotnet-runtime-MIT.txt", "Roslyn-MIT.txt"]
        : ["TeaVM-Apache.txt", "OpenJDK-GPL2.txt", "OpenJDK-Classpath.txt"];
    await fs.mkdir(path.join(stage, "licenses"), { recursive: true });
    for (const name of notices) {
      await fs.copyFile(path.join(licenseRoot, name), path.join(stage, "licenses", name));
    }
    const manifest = {
      kind,
      adapterVersion: require("./runtime-adapters.cjs").ADAPTER_VERSION,
      name: manager.definition(kind).name,
      version,
      files,
      size: Object.values(files).reduce((n, f) => n + f.bytes, 0),
    };
    job.check();
    await fs.writeFile(path.join(stage, "manifest.json"), JSON.stringify(manifest, null, 2));
    await fs.mkdir(path.dirname(target), { recursive: true });
    job.commit();
    await require("./files.cjs").renameWithRetry(stage, target);
    published = true;
    if (!config.selected || manualSource) config.selected = version;
    await manager.write(kind, config);
    registered = true;
    return manager.state(kind);
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
    if (published && !registered) {
      const persisted = await manager.config(kind).catch(() => null);
      if (persisted && persisted.selected !== version) await fs.rm(target, { recursive: true, force: true });
    }
  }
}
function assetMirror(value) {
  if (!value) return "";
  const url=registryURL(value);if(/\.(wasm|mjs|js|zip|exe)\/?$/i.test(new URL(url).pathname))throw Error("请输入运行文件的目录地址，而不是单个文件地址");return url;
}
async function checkBrowserRuntime(kind, job, mirror) {
  const receipt = catalog[kind],
    probes = kind === "java"
      ? receipt.files
      : receipt.files.filter(f => /(?:dotnet\.boot\.js|roslyn-web\.js)$/.test(f.name));
  if (!probes.length) probes.push(receipt.files[0]);
  let changed = false;
  for (const file of probes) {
    const bytes = await responseBytes(
      new URL(file.name, mirror || receipt.base),
      Math.max(file.bytes * 2, 1024 * 1024),
      null,
      job,
      file.name,
    );
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== file.sha256) changed = true;
  }
  return { versions: [receipt.version], checkedAt: new Date().toISOString(), upstreamChanged: changed };
}
module.exports = { catalog, installBrowserRuntime, assetMirror, checkBrowserRuntime };
