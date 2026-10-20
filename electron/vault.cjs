const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const {DATA_FOLDER,isVaultData}=require('./vault-paths.cjs');

const {fileKind}=require('../shared/file-kind.mjs');
const MAX_SIZE = 20 * 1024 * 1024;
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const markdown = (value) => /\.(md|markdown)$/i.test(value);
const fault = (message, code = "INVALID_PATH", current) =>
  Object.assign(new Error(message), { code, current });

class Vault {
  constructor(root) {
    this.root = path.resolve(root);
    this.queue = Promise.resolve();
  }
  async init() {
    this.root = await fs.realpath(this.root);
    return this;
  }
  async resolve(relative, allowMissing = false) {
    if (
      typeof relative !== "string" ||
      !relative ||
      relative.includes("\0") ||
      relative.includes("\\") ||
      relative.split("/").some((p,i) => p === ".." || p.startsWith(".") && !(i===0&&p===DATA_FOLDER)) ||
      path.isAbsolute(relative)
    ) {
      throw fault("文件路径无效。");
    }
    const target = path.resolve(this.root, relative);
    const inside = (p) =>
      p === this.root ||
      (!path.relative(this.root, p).startsWith("..") &&
        !path.isAbsolute(path.relative(this.root, p)));
    if (!inside(target) || target === this.root)
      throw fault("只能操作工作空间内的文件。");
    let existing = target;
    while (true) {
      try {
        const actual = await fs.realpath(existing);
        if (!inside(actual)) throw fault("符号链接指向工作空间外部。");
        break;
      } catch (error) {
        if (error.code !== "ENOENT" || !allowMissing || existing === this.root)
          throw error;
        existing = path.dirname(existing);
      }
    }
    return target;
  }
  async list() {
    let records;
    try {records=(await new (require('./document-map.cjs').DocumentMap)(this).read()).documents;}
    catch(error){if(!this.recoveryError)throw error;records={};}
    const owners = new Map(Object.entries(records).filter(([, r]) => r.directory).map(([doc, r]) => [r.directory, doc]));
    const visit = async (dir, prefix = "", depth = 0) => {
      if (depth > 30) return [];
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const nodes = [];
      for (const entry of entries) {
        if (
          entry.name.startsWith(".") && !(depth===0&&entry.name===DATA_FOLDER) ||
          ["node_modules"].includes(entry.name) ||
          entry.isSymbolicLink()
        )
          continue;
        const relative = prefix + entry.name;
        const stat = await fs.stat(path.join(dir, entry.name)).catch(error => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (!stat) continue;
        if (entry.isDirectory())
          nodes.push({
            path: relative,
            name: entry.name,
            kind: "folder",
            system: isVaultData(relative)||entry.name.startsWith('moyu-tmp-'),
            updated: stat.mtimeMs,
            created: stat.birthtimeMs > 0 ? stat.birthtimeMs : undefined,
            ...(owners.has(relative) ? { companionFor: owners.get(relative) } : {}),
            children: await visit(
              path.join(dir, entry.name),
              relative + "/",
              depth + 1,
            ),
          });
        else if (
          entry.isFile() &&
          true
        ) {
          nodes.push({
            path: relative,
            name: entry.name,
            kind: "file",
            system: isVaultData(relative)||entry.name.startsWith('moyu-tmp-'),
            updated: stat.mtimeMs,
            created: stat.birthtimeMs > 0 ? stat.birthtimeMs : undefined,
            size: stat.size,
          });
        }
      }
      return nodes.sort((a, b) =>
        a.kind === b.kind
          ? a.name.localeCompare(b.name, "zh-CN")
          : a.kind === "folder"
            ? -1
            : 1,
      );
    };
    return {
      ...(this.recoveryError?{readOnly:true}:{}),
      warnings:[...(this.recoveryError?[this.recoveryError]:[]),...(this.scanWarnings||[])],
      root: this.root,
      name: path.basename(this.root),
      tree: await visit(this.root),
    };
  }
  async read(relative) {
    if (!['markdown','html','text'].includes(fileKind(relative))) throw fault('此文件不能作为文本打开。');
    const target = await this.resolve(relative);
    const stat = await fs.stat(target);
    if (stat.size > MAX_SIZE)
      throw fault("文件超过 20 MB，暂不支持打开。", "TOO_LARGE");
    if (!stat.isFile()) throw fault('只能打开普通文件。');
    const bytes = await fs.readFile(target);
    let content;
    try { content = new TextDecoder('utf-8', {fatal:true,ignoreBOM:true}).decode(bytes); }
    catch { throw fault('文件不是 UTF-8 文本。', 'UNSUPPORTED_TEXT'); }
    if(content.includes('\0')) throw fault('不支持编辑二进制文件。', 'UNSUPPORTED_TEXT');
    return {
      path: relative,
      content,
      version: hash(content),
      updated: stat.mtimeMs,
    };
  }
  mutate(action) {
    const result = this.queue.then(()=>{if(this.recoveryError)throw fault(this.recoveryError,'RECOVERY_CONFLICT');return action();});
    this.queue = result.catch(() => {});
    return result;
  }
  save(relative, content, expectedVersion) {
    return this.mutate(async () => {
      if(isVaultData(relative))throw fault('知识库数据请通过设置管理。');
      if (
        !['markdown','html','text'].includes(fileKind(relative)) ||
        typeof content !== "string" ||
        Buffer.byteLength(content) > MAX_SIZE
      )
        throw fault("文档格式或大小无效。");
      const target = await this.resolve(relative);
      const current = await this.read(relative);
      if (current.version !== expectedVersion)
        throw fault(
          "文件已被其他程序修改。请比较两个版本后再保存。",
          "CONFLICT",
          current,
        );
      if (content === current.content) return current;
      await require('./files.cjs').atomic(target, content);
      const saved = await this.read(relative);
      if (this.history) {
        try { await this.history.capture(current, saved); }
        catch (error) { saved.historyWarning = '文档已保存，历史记录失败：' + error.message; }
      }
      return saved;
    });
  }
  create(relative, kind, content = "") {
    return this.mutate(async () => {
      if(isVaultData(relative))throw fault('知识库数据请通过设置管理。');
      if (
        kind !== "folder" &&
        (typeof content !== "string" || Buffer.byteLength(content) > MAX_SIZE)
      )
        throw fault("文档无效或超过 20 MB。", "TOO_LARGE");
      const target = await this.resolve(relative, true);
      const name = path.basename(target);
      if (
        /[<>:"|?*]/.test(name) ||
        name.endsWith(".") ||
        name.endsWith(" ") ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)
      )
        throw fault("名称包含跨平台不支持的字符。");
      if (kind === "folder") {
        await fs.mkdir(target);
        return { path: relative };
      }
      await fs.writeFile(target, content, { flag: "wx", flush: true });
      return ['markdown','html','text'].includes(fileKind(relative))
        ? this.read(relative)
        : {path:relative,content,version:hash(content),updated:(await fs.stat(target)).mtimeMs};
    });
  }
  rename(from, to) {
    return this.mutate(async () => {
      if(isVaultData(from)||isVaultData(to))throw fault('知识库数据请通过设置管理。');
      const source = await this.resolve(from);
      const target = await this.resolve(to, true);
      const name = path.basename(target);
      if (
        /[<>:"|?*]/.test(name) ||
        name.endsWith(".") ||
        name.endsWith(" ") ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)
      )
        throw fault("名称包含跨平台不支持的字符。");
      if (markdown(from) && !markdown(to))
        throw fault("文档需要保留 Markdown 扩展名。");
      if (source === target) return { path: to };
      try {
        await fs.access(target);
        throw fault("这个名称已经存在。", "EXISTS");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await fs.rename(source, target);
      return { path: to };
    });
  }
  async search(query) {
    if (typeof query !== "string" || query.length < 1 || query.length > 200)
      return [];
    const flat = (nodes) =>
      nodes.flatMap((n) => (n.kind === "folder" ? flat(n.children) : [n]));
    const files = flat((await this.list()).tree);
    const needle = query.toLocaleLowerCase();
    const results = [];
    for (const file of files) {
      if (!markdown(file.path) || file.system) continue;
      const document = await this.read(file.path).catch(() => null);
      if (!document) continue;
      const lines = document.content.split("\n");
      const matches = lines
        .map((text, i) => ({ text: text.slice(0, 220), line: i + 1 }))
        .filter((n) => n.text.toLocaleLowerCase().includes(needle))
        .slice(0, 5);
      if (file.path.toLocaleLowerCase().includes(needle) || matches.length)
        results.push({ path: file.path, name: file.name, matches });
      if (results.length >= 100) break;
    }
    return results;
  }
  async attachment(document, filename, bytes) {
    const doc = await this.resolve(document);
    if (
      !markdown(document) ||
      !ArrayBuffer.isView(bytes) ||
      bytes.byteLength > MAX_SIZE
    )
      throw fault("图片无效或超过 20 MB。");
    const extension = path.extname(filename).toLowerCase();
    if (
      ![".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"].includes(extension)
    )
      throw fault("支持 PNG、JPEG、GIF、WebP、AVIF 图片。");
    const {Attachments}=require('./attachments.cjs');
    const name=String(filename||'图片'+extension).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/^[. ]+|[. ]+$/g,'')||'图片'+extension;
    return this.mutate(async()=>(await new Attachments(this).put(document,name,bytes)).link);
  }
}
module.exports = { Vault, hash, fault };
