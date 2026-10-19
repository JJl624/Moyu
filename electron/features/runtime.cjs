const fs = require("node:fs/promises");
const path = require("node:path");
function createRuntimeOperations(services) {
  const selections = new Map();
  const manualFiles = new (require("../manual-runtime-files.cjs").ManualRuntimeFiles)({
    runtimes: services.managedRuntimes,
    python: services.pythonManager,
  });
  const contents = new (require("../runtime-contents.cjs").RuntimeContents)(manualFiles);
  const sourceFor = input => {
    if (!input.token) return null;
    const item = selections.get(input.token);
    if (!item || item.language !== input.language) throw Error("请重新选择环境目录");
    return item.path;
  };
  const imports = new (require("../local-imports.cjs").LocalImports)({
    runtimes: services.managedRuntimes,
    python: services.pythonManager,
    packages: services.javascriptPackages,
  });
  const choose = async (title, archive = false, multiple = false) => {
    const result = await services.dialog.showOpenDialog(services.window, {
      title,
      properties: multiple ? ["openFile", "multiSelections"] : archive ? ["openFile"] : ["openDirectory"],
      ...(archive
        ? {
          filters: [{
            name: multiple ? "Pyodide 包文件" : "npm 包归档",
            extensions: multiple ? ["whl", "zip"] : ["tgz", "gz"],
          }],
        }
        : {}),
    });
    return result.canceled ? [] : result.filePaths;
  };
  return {
    "runtime.contents": input => contents.describe(input.language, input.version),
    "manual-files.choose": async input => {
      manualFiles.manager(input.language);
      const selected = await services.dialog.showOpenDialog(services.window, {
        title: input.directory ? "选择原始运行文件夹" : "选择下载的环境文件（可包含依赖）",
        properties: input.directory ? ["openDirectory"] : ["openFile", "multiSelections"],
      });
      if (selected.canceled) return null;
      const source = selected.filePaths[0];
      if (input.directory) {
        const manifest = await fs.lstat(path.join(source, "manifest.json")).catch(() => null);
        const pkg = await fs.lstat(path.join(source, "package.json")).catch(() => null);
        if (manifest || (!["python", "csharp", "java"].includes(input.language) && pkg)) {
          const token = require("node:crypto").randomUUID(),
            preview = await require("../local-imports.cjs").inspectEnvironment(
              input.language === "python" ? services.pythonManager : services.managedRuntimes,
              input.language,
              source,
            );
          selections.set(token, { language: input.language, path: source });
          while (selections.size > 16) selections.delete(selections.keys().next().value);
          return { directory: { token, ...preview } };
        }
        return { plan: await manualFiles.chooseDirectory(input.language, source) };
      }
      return { plan: await manualFiles.chooseFiles(input.language, selected.filePaths, input.token) };
    },
    "runtime.asset-files": async input => {
      const catalog = require("../browser-runtimes.cjs").catalog,
        receipt = Object.hasOwn(catalog, input.language) ? catalog[input.language] : null;
      if (!receipt) throw Error("该环境使用 npm 包下载源");
      const config = await services.managedRuntimes.config(input.language);
      return receipt.files.map(file => ({
        name: file.name,
        bytes: file.bytes,
        url: new URL(file.name, config.assetMirror || receipt.base).href,
      }));
    },
    "manual-files.identify": async input => {
      manualFiles.manager(input.language);
      const python = input.language === "python";
      const selected = await services.dialog.showOpenDialog(services.window, {
        title: python ? "选择 pyodide.mjs 识别环境版本" : "选择运行环境的 npm .tgz 归档识别版本",
        properties: ["openFile"],
        filters: [{
          name: python ? "Pyodide 加载器" : "npm 环境归档",
          extensions: python ? ["mjs", "js"] : ["tgz", "gz"],
        }],
      });
      return selected.canceled ? null : manualFiles.identify(input.language, selected.filePaths[0], input.token);
    },
    "manual-files.plan": input => manualFiles.create(input.language, input.version, input.token),
    "manual-files.state": input => {
      const plan = manualFiles.get(input.token, input.language);
      return manualFiles.create(input.language, plan.version, input.token);
    },
    "manual-files.select": async input => {
      const plan = manualFiles.get(input.token, input.language),
        row = input.id && plan.files.find(row => row.id === input.id);
      if (input.id && !row) throw Error("请选择清单中的文件");
      const selected = await services.dialog.showOpenDialog(services.window, {
        title: row ? "选择 " + row.name : "选择已下载的环境文件",
        properties: [
          input.directory && row?.type === "bundle" ? "openDirectory" : "openFile",
          ...(row ? [] : ["multiSelections"]),
        ],
      });
      return selected.canceled
        ? manualFiles.create(input.language, plan.version, input.token)
        : row && !input.directory
            && (row.id === "pyodide.mjs"
              || !!row.package && row.package === services.managedRuntimes.definition(input.language)?.package
              || input.language === "ruby" && /^@ruby\/(?:4\.0|3\.4|3\.3|3\.2)-wasm-wasi$/.test(row.package || ""))
        ? manualFiles.identify(input.language, selected.filePaths[0], input.token)
        : manualFiles.select({ ...input, paths: selected.filePaths });
    },
    "runtime.import-files": async input => {
      await services.codeRunner.reset(input.language);
      return manualFiles.install(input);
    },
    "python.import-files": async input => {
      await services.codeRunner.reset("python");
      return manualFiles.install({ ...input, language: "python" });
    },
    "local-import.inspect": async input => {
      if (
        input.language !== "python"
        && !Object.hasOwn(require("../managed-runtimes.cjs").definitions, input.language)
      ) throw Error("不支持的环境");
      const paths = await choose("选择 " + input.language + " 环境目录");
      if (!paths.length) return null;
      const token = require("node:crypto").randomUUID(),
        preview = await require("../local-imports.cjs").inspectEnvironment(
          input.language === "python" ? services.pythonManager : services.managedRuntimes,
          input.language,
          paths[0],
          input.version,
        );
      selections.set(token, { language: input.language, path: paths[0] });
      while (selections.size > 16) selections.delete(selections.keys().next().value);
      return { token, ...preview };
    },
    "runtime.import": async input => {
      const approved = sourceFor(input),
        paths = approved
          ? [approved]
          : await choose("选择 " + input.language + " Runtime 版本目录（包含 manifest.json）");
      if (!paths.length) return services.managedRuntimes.state(input.language);
      await services.codeRunner.reset(input.language);
      return imports.runtime(input.language, paths[0]);
    },
    "python.import-runtime": async input => {
      const approved = sourceFor({ ...input, language: "python" }),
        paths = approved
          ? [approved]
          : await choose("选择完整 Pyodide 环境目录（包含 pyodide.mjs、WASM、标准库和清单）");
      if (!paths.length) return services.pythonManager.state();
      await services.codeRunner.reset("python");
      return imports.pythonRuntime(paths[0], input.version);
    },
    "runtime.reveal": async input => {
      const manager = input.language === "python" ? services.pythonManager : services.managedRuntimes,
        state = await manager.state(input.language);
      if (
        !(input.language === "python"
          ? state.installed.includes(input.version)
          : state.installed.some(v => v.version === input.version))
      ) throw Error("环境尚未安装");
      const error = await require("electron").shell.openPath(
        manager.directory(
          ...(input.language === "python" ? [input.version] : [input.language, input.version]),
        ),
      );
      if (error) throw Error(error);
    },
    "python.import-package": async () => {
      const paths = await choose("选择当前 Pyodide 清单中的包文件及其依赖（可多选）", true, true);
      if (!paths.length) return services.pythonManager.state();
      await services.codeRunner.reset("python");
      return imports.pythonPackages(paths);
    },
    "javascript.import": async input => {
      const paths = await choose(
        input.archive
          ? "选择 npm pack 产生的 .tgz 归档"
          : "选择完整 npm 包目录（包含 package.json 和所需 node_modules）",
        !!input.archive,
      );
      if (!paths.length) return services.javascriptPackages.state();
      await services.codeRunner.reset("javascript");
      return imports.javascript(paths[0], !!input.archive);
    },
    "code.prepare": (input) => services.codeRunner.prepare(input),
    "code.stop": () => services.codeRunner.stop(),
    "code.release-idle": input => {
      if (input.root !== services.vault?.root) return;
      if (!Array.isArray(input.keep) || input.keep.length > 16) throw Error('运行环境列表无效。');
      return services.codeRunner.releaseIdle(input.keep);
    },
    "code.reset-python": () => services.codeRunner.reset("python"),
    "code.runtime-state": (input) => services.runtimeState(String(input.language)),
    "code.runtime-configure": async (input) => {
      const kind = services.codeRunner.kind(String(input.language));
      if (kind === "python") {
        throw new Error("请使用 Python 设置。");
      }
      await services.runtimeSettings.configure(kind, input.settings);
      return services.runtimeState(String(input.language));
    },
    "code.runtime-reset": (input) => services.codeRunner.reset(String(input.language)),
    "runtime.state": (input) => services.managedRuntimes.state(input.language),
    "downloads.state": (input) => services.downloads.state(input.scope),
    "downloads.cancel": (input) => services.downloads.cancel(input.scope, input.id),
    "runtime.configure": (input) => services.managedRuntimes.configure(input),
    "runtime.sql-viewer": async () => {
      const runtime = await services.managedRuntimes.environment("sql");
      return {
        code: await fs.readFile(path.join(runtime.directory, "viewer-runtime.mjs"), "utf8"),
        wasm: await fs.readFile(path.join(runtime.directory, "sql/sql-wasm.wasm")),
      };
    },
    "runtime.refresh": (input) => services.managedRuntimes.refresh(input.language),
    "javascript.state": () => services.javascriptPackages.state(),
    "javascript.configure": (input) => services.javascriptPackages.configure(input),
    "javascript.download": (input) => services.htmlResults.download(input),
    "javascript.versions": (input) => services.javascriptPackages.versions(input),
    ...Object.fromEntries(
      ["install", "select", "remove"].map(
        action => ["javascript." + action, (input) => services.javascriptPackages[action](input)],
      ),
    ),
    ...Object.fromEntries(
      ["install", "select", "remove"].map(action => ["runtime." + action, async (input) => {
        await services.codeRunner.reset(input.language);
        return services.managedRuntimes[action](input);
      }]),
    ),
    "code.format": async (input) => {
      const kind = /^(cs|csharp|c#)$/i.test(input.language)
        ? "csharp"
        : /^java$/i.test(input.language)
        ? "java"
        : null;
      return require("../format.cjs").formatCode({
        ...input,
        formatterDirectory: kind ? (await services.managedRuntimes.environment(kind)).directory : undefined,
      });
    },
    "python.state": () => services.pythonManager.state(),
    ...Object.fromEntries([
      ["refresh-versions", "refreshVersions"],
      ["refresh-packages", "refreshPackages"],
      ["install-runtime", "installRuntime"],
      ["remove-runtime", "removeRuntime"],
      ["select", "select"],
      ["install-package", "installPackage"],
      ["remove-package", "removePackage"],
      ["configure", "configure"],
    ].map(([action, method]) => ["python." + action, async (input) => {
      const result = await services.pythonManager[method](input);
      if (!action.startsWith("refresh-") && action !== "configure") {
        services.codeRunner.close();
        services.codeRunner.open();
      }
      return result;
    }])),
  };
}
module.exports = { createRuntimeOperations };
