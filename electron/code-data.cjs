const fs = require("node:fs/promises");
const path = require("node:path");
const { atomic, eligible, snapshot } = require("./files.cjs");
const { hash, fault } = require("./vault.cjs");
const canonical = language =>
  /^(py|python)$/i.test(language)
    ? "Python"
    : /^(ts|typescript)$/i.test(language)
    ? "TypeScript"
    : /^(js|javascript)$/i.test(language)
    ? "JavaScript"
    : /^c$/i.test(language)
    ? "C"
    : /^(cpp|c\+\+|cc|cxx)$/i.test(language)
    ? "C++"
    : /^(sql|sqlite)$/i.test(language)
    ? "SQL"
    : /^(cs|csharp|c#)$/i.test(language) ? "C#" : /^java$/i.test(language) ? 'Java' : /^(ruby|rb)$/i.test(language) ? 'Ruby' : /^(bash|sh|shell)$/i.test(language) ? 'Bash' : /^lua$/i.test(language)
    ? "Lua"
    : "";
const MAX = 40 * 1024 * 1024;
const legacyDirectory = name => /^(Python|JavaScript|TypeScript|C|C\+\+|SQL|Lua)_([0-9a-f]{4})$/.exec(name);
class CodeData {
  constructor(vault, attachments, references) {
    this.vault = vault;
    this.attachments = attachments;
    this.references = references || new (require("./references.cjs").References)(vault);
    this.documents = attachments.documents;
    this.transaction = new (require('./code-data-transaction.cjs').CodeDataTransaction)(vault);
  }
  identity(input) {
    const language = canonical(String(input.language)), id = String(input.id || "").toLowerCase();
    const global = language === "SQL" && input.scope === "global";
    if (
      (!/^[0-9a-f]{4}$/.test(id) && !(global && id === "global")) || id === "0000"
      || !eligible(input.document)
      || !/\.(md|markdown)$/i.test(input.document)
    ) throw fault("代码块 ID 无效。");
    return { key: global ? "SQL_GLOBAL" : id, language, id, global };
  }
  // Adopt old names once, before opening the workspace. Ambiguous directories are
  // left intact for explicit rebind; never choose one by its current language.
  migrateDirectories() {
    return this.vault.mutate(async () => {
      const map = await this.documents.read(), moves = [];
      for (const record of Object.values(map.documents)) {
        if (!record.directory) continue;
        const root = path.posix.join(record.directory, "code-data");
        const entries = await fs.readdir(await this.vault.resolve(root, true), { withFileTypes: true }).catch(e => {
          if (e.code === "ENOENT") return [];
          throw e;
        });
        const names = new Set(entries.map(e => e.name)), candidates = new Map();
        for (const entry of entries) {
          const match = legacyDirectory(entry.name);
          if (!entry.isDirectory() || entry.isSymbolicLink() || !match || match[2] === "0000") continue;
          const previous = candidates.get(match[2]) || [];
          previous.push(entry.name);
          candidates.set(match[2], previous);
        }
        for (const [id, previous] of candidates) {
          if (previous.length === 1 && !names.has(id)) moves.push({
            from: path.posix.join(root, previous[0]), to: path.posix.join(root, id),
          });
        }
      }
      if (moves.length) await this.references.renameUnlocked({ moves });
      return moves.length;
    });
  }
  async target(input) {
    const { key } = this.identity(input);
    return path.posix.join(await this.documents.directory(input.document), "code-data", key);
  }
  async ensure(input) {
    await this.documents.ensureUnlocked(input.document);
    const directory = await this.target(input);
    await fs.mkdir(await this.vault.resolve(directory, true), { recursive: true });
    await this.vault.resolve(directory);
    return directory;
  }
  async entries(directory, withData = true) {
    const result = [];
    let total = 0;
    const root = await this.vault.resolve(directory, true);
    if (!await fs.lstat(root).catch(() => null)) return result;
    const visit = async (relative, depth = 0) => {
      if (depth > 12) throw fault("代码数据目录层级超过 12 层。");
      const absolute = await this.vault.resolve(relative);
      if ((await fs.lstat(absolute)).isSymbolicLink()) throw fault("代码数据不读取符号链接。");
      for (const entry of await fs.readdir(absolute, { withFileTypes: true })) {
        const name = path.posix.join(relative, entry.name);
        if (!eligible(name) || entry.isSymbolicLink()) {
          throw fault("代码数据包含不支持的文件名或符号链接。");
        }
        if (entry.isDirectory()) await visit(name, depth + 1);
        else if (entry.isFile()) {
          const stat = await fs.stat(await this.vault.resolve(name));
          if (stat.size > 20 * 1024 * 1024) throw fault("数据文件超过 20 MB。");
          total += stat.size;
          if (total > MAX || result.length >= 128) {
            throw fault("单个代码块的数据最多 128 个文件、共 40 MB。");
          }
          const file = withData ? await snapshot(this.vault, name) : null;
          result.push({
            name: path.posix.relative(directory, name),
            size: stat.size,
            ...(file ? { data: file.bytes.toString("base64"), version: file.version } : {}),
          });
        }
      }
    };
    await visit(directory);
    return result;
  }

  async context(input) {
    if (!input.document) return { files: [] };
    const normalized = await this.documents.sync(
      input.document,
      typeof input.markdown === "string"
        ? input.markdown
        : (await this.vault.read(input.document)).content,
    );
    this.identity(input);
    if (
      !canonical(input.language) || !normalized.blocks.some(b =>
        b.id === String(input.id).toLowerCase()
        && canonical(b.language) === canonical(input.language)
      )
    ) throw fault("代码块已改变，请重新运行。");
    if (["SQL","Bash"].includes(canonical(input.language)) && input.scope === "memory") return { files: [], memory: true };
    const directory = await this.target(input);
    await this.vault.resolve(input.document);
    if (this.identity(input).global) await this.vault.mutate(() => this.ensure(input));
    return { directory, files: await this.entries(directory) };
  }
  persist(input, context, files) {
    if (!input.document || context.memory) return;
    return this.vault.mutate(async () => {
      if (!Array.isArray(files) || files.length > 128) throw fault("代码数据输出无效。");
      let total = 0;
      const next = new Map();
      for (const file of files) {
        if (
          typeof file?.name !== "string" || !eligible(file.name) || typeof file.data !== "string"
          || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)
        ) throw fault("代码数据文件名或内容无效。");
        const bytes = Buffer.from(file.data, "base64");
        total += bytes.length;
        if (bytes.length > 20 * 1024 * 1024 || total > MAX || next.has(file.name)) {
          throw fault("代码数据超过限制。");
        }
        next.set(file.name, bytes);
      }
      const versions=new Map([...next].map(([name,bytes])=>[name,hash(bytes)]));
      const metadata=[...versions].map(([name,version])=>({name,version}));
      const before = new Map(context.files.map(f => [f.name, f])),
        changed = [...new Set([...before.keys(), ...next.keys()])].filter(name =>
          next.has(name) ? before.get(name)?.version !== versions.get(name) : true
        );
      if (!changed.length) return metadata;
      await this.vault.resolve(input.document);
      const directory = await this.target(input);
      const changes=[];
      for (const name of changed) {
        const disk = await snapshot(this.vault, path.posix.join(directory, name));
        if ((disk?.version || null) !== (before.get(name)?.version || null)) {
          throw fault("数据文件已在外部修改：" + name, "CONFLICT");
        }
        changes.push({path:path.posix.join(directory,name),previous:disk,next:next.get(name)||null});
      }
      await this.ensure(input);
      await this.transaction.write(changes);
      return metadata;
    });
  }

  async list(input) {
    if (!input.document) return [];
    await this.vault.resolve(input.document);
    const blocks = (await import("../shared/code-documents.mjs")).parseBlocks(
        typeof input.content === "string"
          ? input.content
          : (await this.vault.read(input.document)).content,
      ),
      root = path.posix.join(
        await this.documents.directory(input.document),
        "code-data",
      ),
      absolute = await this.vault.resolve(root, true),
      groups = [];
    for (
      const entry of await fs.readdir(absolute, { withFileTypes: true }).catch(e => {
        if (e.code === "ENOENT") return [];
        throw e;
      })
    ) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const legacy = legacyDirectory(entry.name), global = entry.name === "SQL_GLOBAL";
      if (!global && !legacy && !/^(?!0000)[0-9a-f]{4}$/.test(entry.name)) continue;
      const id = global ? "global" : legacy?.[2] || entry.name,
        directory = path.posix.join(root, entry.name),
        block = !legacy && blocks.find(b => b.id === id),
        language = global ? "SQL" : block ? canonical(block.language) || block.language : legacy?.[1] || "";
      const associated = global || !!block;
      groups.push({
        key: entry.name,
        id,
        language,
        global,
        associated,
        path: directory,
        files: (await this.entries(directory, false)).map(f => ({
          name: f.name,
          path: path.posix.join(directory, f.name),
          size: f.size,
        })),
      });
    }
    return groups;
  }
  create(input) {
    if(typeof input.name!=="string" || input.name.includes("/"))return Promise.reject(fault("请输入不含目录路径的文件名。"));
    return this.upload({...input,bytes:new Uint8Array(0)});
  }
  upload(input) {
    return this.vault.mutate(async () => {
      this.identity(input);
      await this.documents.syncUnlocked(
        input.document,
        typeof input.content === "string"
          ? input.content
          : (await this.vault.read(input.document)).content,
      );
      if (
        typeof input.name !== "string" || !eligible(input.name) || !ArrayBuffer.isView(input.bytes)
        || input.bytes.byteLength > 20 * 1024 * 1024
      ) throw fault("数据文件无效或超过 20 MB。");
      await this.vault.resolve(input.document);
      const directory = await this.target(input), old = await this.entries(directory, false);
      if (
        old.length >= 128 || old.reduce((sum, f) => sum + f.size, 0) + input.bytes.byteLength > MAX
      ) throw fault("代码数据超过 128 个文件或 40 MB。");
      const destination = path.posix.join(directory, input.name),
        absolute = await this.vault.resolve(destination, true);
      if (await fs.lstat(absolute).catch(() => null)) throw fault("数据文件已存在。", "EEXIST");
      await this.ensure(input);
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await this.vault.resolve(destination, true);
      await fs.writeFile(absolute, input.bytes, { flag: "wx", flush:true });
      return { path: destination };
    });
  }
  remove(input) {
    return this.vault.mutate(async () => {
      this.identity(input);
      if (!eligible(input.name)) throw fault("数据文件名无效。");
      const relative = path.posix.join(await this.target(input), input.name);
      await snapshot(this.vault, relative);
      await fs.unlink(await this.vault.resolve(relative));
    });
  }
  rebind(input) {
    return this.vault.mutate(async () => {
      if (typeof input.content === "string") {
        await this.documents.syncUnlocked(input.document, input.content);
      }
      const groups = await this.list(input),
        source = groups.find(g => g.key === input.key);
      if (!source || source.associated || source.global) throw fault("请选择未关联的数据目录。");
      const target = this.identity(input),
        blocks = (await import("../shared/code-documents.mjs")).parseBlocks(
          typeof input.content === "string"
            ? input.content
            : (await this.vault.read(input.document)).content,
        ),
        block = blocks.find(b => b.id === target.id);
      if (
        target.global || !block
      ) throw fault("请选择代码块。");
      return this.references.renameUnlocked({ from: source.path, to: await this.target(input) });
    });
  }
}
module.exports = { CodeData, canonical };
