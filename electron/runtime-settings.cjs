const { eligible } = require("./files.cjs");
const C_STANDARDS = ["gnu23", "c23", "c17", "c11", "c99", "c90"];
const CPP_STANDARDS = ["gnu++23", "c++23", "c++20", "c++17", "c++14", "c++11"];
const DEFAULTS = {
  javascript: { executionTimeoutSeconds: 10, preparationTimeoutSeconds: 60 },
  sql: {
    executionTimeoutSeconds: 10,
    preparationTimeoutSeconds: 60,
    databaseFile: "database.sqlite",
    foreignKeys: true,
    maxRows: 1000,
  },
  lua: { executionTimeoutSeconds: 10, preparationTimeoutSeconds: 60, stdinFile: "stdin.txt", enableModules: true },
  csharp: {
    executionTimeoutSeconds: 10,
    preparationTimeoutSeconds: 120,
    multiFile: true,
    stdinFile: "stdin.txt",
    usings: ["System", "System.IO", "System.Linq", "System.Collections.Generic"],
  },
  java: { executionTimeoutSeconds: 10, preparationTimeoutSeconds: 120, multiFile: true, autoMain: true, mainClass: "" },
  ruby: { executionTimeoutSeconds: 10, preparationTimeoutSeconds: 60, stdinFile: "stdin.txt" },
  bash: {
    executionTimeoutSeconds: 10,
    preparationTimeoutSeconds: 60,
    stdinFile: "stdin.txt",
    maxCommands: 100000,
    maxLoopIterations: 100000,
    memoryLimitMB: 128,
  },
  clang: {
    executionTimeoutSeconds: 10,
    preparationTimeoutSeconds: 60,
    autoMain: true,
    multiFile: true,
    stdinFile: "stdin.txt",
    cStandard: "gnu23",
    cppStandard: "gnu++23",
    cHeaders: ["stdio.h", "stdlib.h"],
    cppHeaders: ["iostream"],
    optimizationLevel: "default",
  },
};
function validate(kind, patch, previous = DEFAULTS[kind]) {
  if (!Object.hasOwn(DEFAULTS, kind) || !previous || !patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("运行设置无效。");
  }
  const result = structuredClone(previous);
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(DEFAULTS[kind], key)) throw new Error("不支持的运行设置：" + key);
    if (key.endsWith("TimeoutSeconds")) {
      if (!Number.isInteger(value) || value < 1 || value > 3600) throw new Error("运行时限需要是 1 到 3600 秒的整数。");
    } else if (["autoMain", "multiFile", "foreignKeys", "enableModules"].includes(key)) {
      if (typeof value !== "boolean") throw new Error("开关设置无效。");
    } else if (key === "optimizationLevel") {
      if (!["default", "O0", "O1", "O2", "O3", "Os", "Oz"].includes(value)) throw Error("编译优化级别无效");
    } else if (key === "usings") {
      if (
        !Array.isArray(value) || value.length > 64
        || value.some(v => typeof v !== "string" || v.length > 150 || !/^[A-Za-z_][\w]*(?:\.[A-Za-z_]\w*)*$/.test(v))
      ) throw Error("using 命名空间无效。");
    } else if (key === "mainClass") {
      if (
        typeof value !== "string" || value.length > 200
        || value && !/^[\p{L}_$][\p{L}\p{N}_$]*(?:\.[\p{L}_$][\p{L}\p{N}_$]*)*$/u.test(value)
      ) throw Error("Java 主类名称无效。");
    } else if (["maxCommands", "maxLoopIterations"].includes(key)) {
      if (!Number.isInteger(value) || value < 1 || value > 10000000) {
        throw Error("命令和循环上限需要是 1 到 10000000 的整数。");
      }
    } else if (key === "memoryLimitMB") {
      if (!Number.isInteger(value) || value < 16 || value > 256) throw Error("内存上限需要是 16 到 256 MB 的整数。");
    } else if (key === "stdinFile" || key === "databaseFile") {
      if (
        typeof value !== "string" || value.length > 120 || value && !eligible(value) || key === "databaseFile" && !value
      ) throw new Error("数据文件名无效。");
    } else if (key === "maxRows") {
      if (!Number.isInteger(value) || value < 1 || value > 1000) throw new Error("结果行数需要是 1 到 1000 的整数。");
    } else if (key === "cStandard" || key === "cppStandard") {
      if (!(key === "cStandard" ? C_STANDARDS : CPP_STANDARDS).includes(value)) throw new Error("语言标准无效。");
    } else {
      if (
        !Array.isArray(value) || value.length > 64 || value.some(header =>
          typeof header !== "string" || header.length > 120 || !/^[a-zA-Z\d_][a-zA-Z\d_./+-]*$/.test(header)
          || header.split("/").some(part => !part || part === ".." || part === ".")
        )
      ) throw new Error("头文件名称无效，请填写名称，例如 stdio.h。");
      result[key] = [...new Set(value)];
      continue;
    }
    result[key] = value;
  }
  return result;
}
class RuntimeSettings {
  constructor(root) {
    this.store = new (require('./application-config.cjs').ApplicationConfig)(root);
    this.file = this.store.file;
    this.queue = Promise.resolve();
  }
  async read() {
    try {
      const value = await this.store.get('code');
      if (value.javascript) delete value.javascript.mode;
      for (const settings of Object.values(value)) {
        if (settings && typeof settings === "object") delete settings.arguments;
      }
      return value;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return {};
    }
  }
  async config(kind) {
    const config = await this.read();
    return validate(kind, config[kind] || {});
  }
  configure(kind, patch) {
    let configured;
    const task = this.store.update('code', config => {
      config[kind] = validate(kind, patch, validate(kind, config[kind] || {}));
      configured = config[kind];
      return config;
    }).then(() => configured);
    this.queue = task.catch(() => {});
    return task;
  }
}
module.exports = { RuntimeSettings, DEFAULTS, C_STANDARDS, CPP_STANDARDS, validate };
