const fs = require("node:fs/promises"), path = require("node:path");
const { atomic, eligible } = require("./files.cjs");
const { fault } = require("./vault.cjs");
const {DATA_FOLDER}=require('./vault-paths.cjs');
const { links, localPath } = require("./references.cjs");
const { readableNote } = require('./readable-note.cjs');
const markdown = name => /\.(md|markdown)$/i.test(name);
const model = () => import("../shared/code-documents.mjs");
// Language is derived from Markdown, never part of ownership or identity.
const blockRecords = blocks => [...new Set(Array.isArray(blocks) ? blocks : Object.keys(blocks || {}))]
  .filter(id => typeof id === 'string' && /^[a-f\d]{4}$/i.test(id)).map(id => id.toLowerCase()).sort();
class DocumentMap {
  constructor(vault) {
    this.vault = vault;
  }
  async file(create = false) {
    const dir = path.join(this.vault.root, DATA_FOLDER);
    if (create) await fs.mkdir(dir, { recursive: true });
    if (
      (await fs.lstat(dir).catch(e => {
        if (e.code === "ENOENT") return null;
        throw e;
      }))?.isSymbolicLink()
    ) throw fault("索引目录不能是符号链接。");
    return path.join(dir, "document_map.json");
  }
  async read() {
    try {
      const value = JSON.parse(await fs.readFile(await this.file(), "utf8"));
      if (![1, 2].includes(value.version) || !value.documents) throw fault("文档映射格式无效。");
      value.version = 2;
      value.documents = Object.fromEntries(
        Object.entries(value.documents).map(([name, r]) => [name, {
          nextId: r.nextId,
          blocks: blockRecords(r.savedBlocks || r.blocks),
          ...(r.directory ? { directory: r.directory } : {}),
        }]),
      );
      return value;
    } catch (e) {
      if (e.code === "ENOENT") return { version: 2, documents: {} };
      throw e;
    }
  }
  async blockIds(content) {
    return blockRecords((await model()).parseBlocks(content).filter(b => b.id).map(b => b.id));
  }
  owner(document, record) {
    return JSON.stringify(
      {
        version: 2,
        document,
        nextId: record.nextId,
        blocks: record.blocks,
      },
      null,
      2,
    );
  }
  async write(value, touched) {
    const file = await this.file(true), text = JSON.stringify(value, null, 2);
    if (await fs.readFile(file, "utf8").catch(() => null) !== text) await atomic(file, text);
    for (const [document, record] of Object.entries(value.documents)) {
      if (!record.directory || touched && !touched.includes(document)) continue;
      const folder = await this.vault.resolve(record.directory, true);
      if (!await fs.lstat(folder).catch(() => null)) continue;
      const owner = await this.vault.resolve(
        path.posix.join(record.directory, "document.json"),
        true,
      );
      if ((await fs.lstat(owner).catch(() => null))?.isSymbolicLink()) {
        throw fault("目录记录不能是符号链接。");
      }
      const body = this.owner(document, record);
      if (await fs.readFile(owner, "utf8").catch(() => null) !== body) await atomic(owner, body);
    }
  }
  async discover() {
    const map = await this.read();
    this.vault.scanWarnings=[];
    let count = 0;
    const visit = async (relative = "", depth = 0) => {
      if (depth > 30 || ++count > 10000) {if(!this.vault.scanWarnings.length)this.vault.scanWarnings.push('附属目录扫描已达到层级或目录数量限制，部分目录未扫描。');return;}
      const absolute = relative ? await this.vault.resolve(relative) : this.vault.root;
      for (const entry of await fs.readdir(absolute, { withFileTypes: true })) {
        if (
          !entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".")
          || entry.name.startsWith("moyu-tmp-") || [".data", "node_modules"].includes(entry.name)
        ) continue;
        const directory = path.posix.join(relative, entry.name),
          owner = await this.vault.resolve(path.posix.join(directory, "document.json"), true);
        try {
          const stat = await fs.lstat(owner);
          if (stat.isFile() && !stat.isSymbolicLink() && stat.size < 4 * 1024 * 1024) {
            const data = JSON.parse(await fs.readFile(owner, "utf8"));
            if (
              [1, 2].includes(data.version) && typeof data.document === "string" && eligible(data.document)
              && markdown(data.document) && data.blocks && typeof data.blocks === "object"
            ) {
              const old = map.documents[data.document];
              if (
                !old?.directory
                || !await fs.lstat(await this.vault.resolve(old.directory, true)).catch(() => null)
              ) {
                map.documents[data.document] = {
                  nextId: Math.max(old?.nextId || 1, data.nextId || 1),
                  blocks: blockRecords(data.blocks),
                  directory,
                };
              } else if (old.directory === directory) {
                old.nextId = Math.max(old.nextId || 1, data.nextId || 1);
              }
            }
          }
        } catch (e) {
          if (!["ENOENT"].includes(e.code) && !(e instanceof SyntaxError)) throw e;
        }
        await visit(directory, depth + 1);
      }
    };
    await visit();
    for(const [document,record] of Object.entries(map.documents)){
      if(!await fs.lstat(await this.vault.resolve(document,true)).catch(error=>{if(error.code==='ENOENT')return null;throw error;})
        &&(!record.directory||!await fs.lstat(await this.vault.resolve(record.directory,true)).catch(error=>{if(error.code==='ENOENT')return null;throw error;})))delete map.documents[document];
    }
    await this.write(map);
  }

  root(document) {
    if (!eligible(document) || !markdown(document)) throw fault("请选择 Markdown 文档。");
    return document.replace(/\.(md|markdown)$/i, "") + ".assets";
  }
  async syncUnlocked(document, content, floor = 1) {
    const registry = await this.read(),
      record = registry.documents[document] ||= { nextId: 1, blocks: [] };
    const api = await model(),
      normalized = api.normalizeIds(content, Math.max(record.nextId, floor || 1));
    record.nextId = normalized.next;
    const disk = await this.vault.read(document);
    record.blocks = await this.blockIds(disk.content);
    await this.write(registry, [document]);
    return { ...normalized, blocks: api.parseBlocks(normalized.content) };
  }
  async counter(document) {
    try{const map=await this.read();return {next:map.documents[document]?.nextId||1};}
    catch(error){if(this.vault.recoveryError)return {next:1};throw error;}
  }
  sync(document, content, floor) {
    return this.vault.mutate(() => this.syncUnlocked(document, content, floor));
  }
  async ensureUnlocked(document) {
    await this.vault.resolve(document);
    const map = await this.read(), record = map.documents[document] ||= { nextId: 1, blocks: [] };
    const directory = record.directory || this.root(document),
      target = await this.vault.resolve(directory, true);
    if ((await fs.lstat(target).catch(() => null)) && !record.directory) {
      // A newly imported document may already carry its own companion record.
      // Adopt that explicit owner; never claim an unrelated same-name folder.
      const owner=await this.vault.resolve(path.posix.join(directory,'document.json'),true);let existing;
      if(!(await fs.lstat(owner).catch(()=>null))?.isSymbolicLink()){try{existing=JSON.parse(await fs.readFile(owner,'utf8'));}catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;}}
      if(existing?.version!==2||existing.document!==document||!Array.isArray(existing.blocks)||!Number.isInteger(existing.nextId)||existing.nextId<1||existing.nextId>65536)throw fault("同名文件夹已存在，不能作为新的附属目录：" + directory, "EEXIST");
      record.nextId=Math.max(record.nextId||1,existing.nextId);
    }
    if (
      Object.entries(map.documents).some(([doc, value]) =>
        doc !== document && value.directory && value.directory === directory
      )
    ) throw fault("附属目录已关联其他文档。");
    let ancestor = this.vault.root;
    for (const part of directory.split("/")) {
      ancestor = path.join(ancestor, part);
      if ((await fs.lstat(ancestor).catch(() => null))?.isSymbolicLink()) {
        throw fault("附属目录不能使用符号链接。");
      }
    }
    await fs.mkdir(target, { recursive: true });
    await this.vault.resolve(directory);
    for (const name of ["attachments", "code-data"]) {
      const folder = await this.vault.resolve(path.posix.join(directory, name), true);
      await fs.mkdir(folder, { recursive: true });
    }
    record.directory = directory;
    record.blocks = await this.blockIds((await this.vault.read(document)).content);
    await this.write(map, [document]);
    return directory;
  }
  async directory(document) {
    const map = await this.read();
    return map.documents[document]?.directory || this.root(document);
  }
  async orphans() {
    const map = await this.read(), missing = [];
    for (const [document, record] of Object.entries(map.documents)) {
      if (
        record.directory
        && !await fs.lstat(await this.vault.resolve(document, true)).catch(() => null)
        && await fs.lstat(await this.vault.resolve(record.directory, true)).catch(() => null)
      ) {
        missing.push([document, record]);
      }
    }
    if (!missing.length) return [];
    const state = await this.vault.list(), files = [], inventory = new Set();
    const walk = nodes =>
      nodes.forEach(n =>
        n.kind === "folder"
          ? walk(n.children || [])
          : (inventory.add(n.path), !n.system && markdown(n.path) && files.push(n))
      );
    walk(state.tree);
    const candidates = [];
    for (const file of files) {
      if (
        Object.values(map.documents).some(r =>
          r.directory && file.path.startsWith(r.directory + "/")
        )
      ) continue;
      const doc = await readableNote(this.vault, file.path);
      if (!doc) continue;
      candidates.push({
        path: file.path,
        blocks: (await model()).parseBlocks(doc.content),
        links: await links(doc.content),
      });
    }
    const results = [];
    for (const [document, record] of missing) {
      const saved = new Set(record.blocks), previous = saved.size;
      const matches = candidates.filter(c => {
        if (map.documents[c.path]?.directory) return false;
        // External moves may leave relative URLs based on the former document location.
        // Match actual owned files from either base, without duplicating document content.
        if (
          c.links.some(n =>
            [c.path, document].some(base => {
              const target = localPath(base, n.url);
              return target.startsWith(record.directory + "/attachments/")
                && inventory.has(target);
            })
          )
        ) return true;
        if (this.root(c.path) === record.directory) return true;
        const matching = c.blocks.filter(b => b.id && saved.has(b.id)).length;
        // IDs belong to a document and are not evidence of identity on their own.
        // A moved document with the same filename can be matched conservatively;
        // renamed documents require an actual attachment reference above.
        return path.posix.basename(c.path)===path.posix.basename(document)
          && previous > 0 && matching / Math.max(previous, c.blocks.length) >= 0.6;
      });
      results.push({ document, directory: record.directory, candidates: matches.map(c => c.path) });
    }
    return results;
  }
}
module.exports = { DocumentMap, markdown };
