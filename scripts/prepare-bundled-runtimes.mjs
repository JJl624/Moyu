import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
const root = path.resolve(import.meta.dirname, ".."), require = createRequire(import.meta.url);
const { ManagedRuntimes, definitions } = require("../electron/managed-runtimes.cjs");
const output = path.join(root, "resources/bundled-runtimes");
const caches = JSON.parse(process.env.MOYU_BUILD_RUNTIME_ROOTS || "[]").map(p => path.resolve(p));
const manager = new ManagedRuntimes(path.join(root, ".runtime-build"));
async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
const { build } = await import("esbuild");
const { gunzipSync } = await import("node:zlib");
const { compilerAssetCachePlugin } = await import("./clang-memory-adapter.mjs");
const adapters = require("../electron/runtime-adapters.cjs");
const index = { version: 1, runtimes: [] };
for (const [kind, definition] of Object.entries(definitions)) {
  const version = definition.recommended;
  let source;
  for (const cache of [output, ...caches.map(p => path.join(p, "runtimes")), manager.root]) {
    const candidate = cache === output ? path.join(cache, kind, version) : path.join(cache, kind, "Runtime", version);
    if (await fs.stat(path.join(candidate, "manifest.json")).catch(() => null)) {
      source = candidate;
      break;
    }
  }
  if (!source) {
    await manager.install({ language: kind, version });
    source = manager.directory(kind, version);
  }
  const manifest = JSON.parse(await fs.readFile(path.join(source, "manifest.json"), "utf8"));
  if (manifest.kind !== kind || manifest.version !== version) throw Error("Runtime version mismatch: " + kind);
  for (const [name, expected] of Object.entries(manifest.files)) {
    const file = path.join(source, name), stat = await fs.stat(file);
    if (stat.size !== expected.bytes || await digest(file) !== expected.sha256) {
      throw Error("Runtime asset mismatch: " + name);
    }
  }
  const directory = path.join(output, kind, version);
  await fs.mkdir(directory, { recursive: true });
  if (source !== directory) {
    const selected = [
      kind,
      "licenses",
      "manifest.json",
      kind + "-runtime.mjs",
      ...(kind === "sql" ? ["viewer-runtime.mjs"] : []),
      ...(kind === "clang" ? ["clang-source.cjs"] : []),
      ...(kind === "java" ? ["managed-source.cjs", "clang-source.cjs", "formatter-browser.mjs"] : []),
      ...(kind === "csharp" ? ["formatter.wasm"] : []),
    ];
    for (const name of selected) {
      if (await fs.stat(path.join(source, name)).catch(() => null)) {
        await fs.cp(path.join(source, name), path.join(directory, name), { recursive: true });
      }
    }
    // Retain dependency licenses without duplicate package binaries and source trees.
    const notices = path.join(directory, "licenses/packages");
    let next = 0;
    async function licenses(folder) {
      for (const entry of await fs.readdir(folder, { withFileTypes: true }).catch(() => [])) {
        const file = path.join(folder, entry.name);
        if (entry.isSymbolicLink()) throw Error("Runtime contains a symlink");
        if (entry.isDirectory()) await licenses(file);
        else if (/^(license|notice|copying|legal|third.party.notices)([.-]|$)/i.test(entry.name)) {
          await fs.mkdir(notices, { recursive: true });
          await fs.copyFile(file, path.join(notices, (++next) + "-" + entry.name));
        }
      }
    }
    await licenses(path.join(source, "node_modules"));
    await licenses(path.join(source, "formatter"));
  }
  const worker = path.join(root, "electron/runner", kind + "-worker.mjs");
  const sourceNames = [
    kind + "-worker.mjs",
    "run-files.mjs",
    "file-runtime.mjs",
    ...(kind === "clang" ? ["clang-project.mjs", "clang-lifetime.mjs", "clang-workspace.mjs"] : []),
    ...(kind === "bash" ? ["bash-terminal.mjs"] : []),
  ];
  const hash = createHash("sha256");
  const addSource = async file => hash.update((await fs.readFile(file, "utf8")).replaceAll("\r\n", "\n"));
  for (const name of sourceNames) await addSource(path.join(root, "electron/runner", name));
  await addSource(path.join(root, "electron/managed-source.cjs"));
  await addSource(path.join(root, "electron/clang-source.cjs"));
  if (kind === "clang") await addSource(path.join(root, "scripts/clang-memory-adapter.mjs"));
  const adapterHash = hash.digest("hex");
  if (manifest.bundledAdapterHash !== adapterHash) {
    let fullSource = source;
    if (["ruby", "bash"].includes(kind) && !(await fs.stat(path.join(fullSource, "node_modules")).catch(() => null))) {
      fullSource = null;
      for (const cache of [...caches, path.dirname(manager.root)]) {
        const candidate = path.join(cache, "runtimes", kind, "Runtime", version);
        if (await fs.stat(path.join(candidate, "node_modules")).catch(() => null)) {
          fullSource = candidate;
          break;
        }
      }
      if (!fullSource) {
        await manager.install({ language: kind, version });
        fullSource = manager.directory(kind, version);
      }
    }
    const plugins = [{
      name: "no-host",
      setup(builder) {
        builder.onResolve(
          { filter: /.*/ },
          args => require("node:module").isBuiltin(args.path) ? { path: args.path, namespace: "no-host" } : undefined,
        );
        builder.onLoad({ filter: /.*/, namespace: "no-host" }, () => ({ contents: "module.exports={}", loader: "js" }));
      },
    }];
    if (kind === "clang") {
      const sizes = {};
      for (const name of ["memfs.wasm.gz", "clang.wasm.gz", "lld.wasm.gz", "sysroot.tar.gz"]) {
        sizes["https://clang.moyu.invalid/clang/bin/" + name] =
          gunzipSync(await fs.readFile(path.join(directory, "clang/bin", name))).length;
      }
      plugins.push(compilerAssetCachePlugin(sizes));
    }
    await build({
      entryPoints: [worker],
      outfile: path.join(directory, kind + "-runtime.mjs"),
      bundle: true,
      platform: "browser",
      format: "esm",
      target: "chrome144",
      minify: true,
      legalComments: "eof",
      nodePaths: [path.join(fullSource, "node_modules")],
      plugins,
    });
    manifest.adapterVersion = ["clang", "lua"].includes(kind)
      ? 1
      : kind === "bash"
      ? adapters.BASH_ADAPTER_VERSION
      : adapters.ADAPTER_VERSION;
    manifest.bundledAdapterHash = adapterHash;
    await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
  }
  const bundledPackages = [];
  async function packages(folder) {
    for (const entry of await fs.readdir(folder, { withFileTypes: true }).catch(() => [])) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await packages(file);
      else if (entry.name === "package.json") {
        try {
          const info = JSON.parse(await fs.readFile(file, "utf8"));
          if (
            info.name && info.version && !bundledPackages.some(p => p.name === info.name && p.version === info.version)
          ) bundledPackages.push({ name: info.name, version: info.version, purpose: info.description });
        } catch {}
      }
    }
  }
  if (source !== directory) {
    await packages(path.join(source, "node_modules"));
    await packages(path.join(source, "formatter"));
    manifest.bundledPackages = bundledPackages;
    await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
  }
  const files = {};
  async function inventory(folder, prefix = "") {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const name = prefix + entry.name, file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw Error("Runtime contains a symlink");
      if (entry.isDirectory()) await inventory(file, name + "/");
      else files[name] = { bytes: (await fs.stat(file)).size, sha256: await digest(file) };
    }
  }
  await inventory(directory);
  index.runtimes.push({ kind, version, files });
  console.log(
    "Bundled",
    kind,
    version,
    Object.keys(files).length,
    "files",
    Math.round(Object.values(files).reduce((a, f) => a + f.bytes, 0) / 1024 / 1024) + "MB",
  );
}
await fs.writeFile(path.join(output, "index.json"), JSON.stringify(index, null, 2) + "\n");
