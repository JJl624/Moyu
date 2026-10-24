const nativeFs = require("node:fs");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { atomic, eligible, snapshot, replace } = require("./files.cjs");
const { hash, fault } = require("./vault.cjs");
const { rewrite, links, referencePath } = require("./references.cjs");
const { readableNote } = require('./readable-note.cjs');
const {isVaultData, DATA_FOLDER} = require('./vault-paths.cjs');
const inside = (file, root) => file === root || file.startsWith(root + "/");
const remap = (file, moves) => {
  const move = moves.find(m => inside(file, m.from));
  return move ? move.to + file.slice(move.from.length) : file;
};
class DocumentFiles {
  constructor(vault, attachments, references, trash) {
    this.vault = vault;
    this.attachments = attachments;
    this.documents = attachments.documents;
    this.references = references;
    this.trashItem = trash;
  }
  async digest(relative) {
    if (!eligible(relative)) throw fault("文件路径无效。");
    const absolute = await this.vault.resolve(relative, true);
    let ancestor = this.vault.root;
    for (const part of relative.split("/")) {
      ancestor = path.join(ancestor, part);
      const stat = await fs.lstat(ancestor).catch(e => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
      if (stat?.isSymbolicLink()) throw fault("不操作符号链接。");
      if (!stat) return null;
    }
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) throw fault("请选择普通文件。");
    const checksum = crypto.createHash("sha256");
    for await (const chunk of nativeFs.createReadStream(absolute)) checksum.update(chunk);
    return { version: checksum.digest("hex"), size: stat.size };
  }
  async inventory() {
    const state = await this.vault.list(), files = [];
    const walk = nodes =>
      nodes.forEach(n =>
        n.kind === "folder" ? walk(n.children || []) : !n.system && files.push(n.path)
      );
    walk(state.tree);
    return files;
  }
  async buffers(input) {
    const buffers = new Map();
    for (const b of input.buffers || []) {
      if (typeof b.content !== "string") {
        throw fault("文档内容无效。");
      }
      const disk = await this.vault.read(b.path);
      if (disk.version !== b.version) throw fault("文档已被外部修改：" + b.path, "CONFLICT", disk);
      buffers.set(b.path, b);
    }
    return buffers;
  }
  structure(relative, map) {
    for (const owner of Object.values(map.documents)) {
      if (
        owner.directory
        && (relative === owner.directory || relative === owner.directory + "/attachments"
          || relative === owner.directory + "/code-data"
          || relative === owner.directory + "/document.json"
          || new RegExp(
            "^" + owner.directory.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/code-data/[^/]+$",
          ).test(relative))
      ) throw fault("请通过文档操作附属目录；代码数据目录请在数据面板重新关联。");
    }
  }
  async rename(input) {
    return this.vault.mutate(async () => {
      const map = await this.documents.read();
      this.structure(input.from, map);
      this.structure(input.to, map);
      const moves = [{ from: input.from, to: input.to }],
        next = {},
        overrides = [];
      for (const [document, record] of Object.entries(map.documents)) {
        const originalDirectory = record.directory, name = remap(document, moves);
        if (name !== document && record.directory) {
          const destination = this.documents.root(name);
          if (record.directory !== destination && !inside(record.directory, input.from)) {
            moves.push({ from: record.directory, to: destination });
          }
          record.directory = destination;
        }
        next[name] = record;
        if (name !== document && record.directory) {
          const owner = await this.vault.read(path.posix.join(originalDirectory, "document.json"))
            .catch(e => {
              if (e.code === "ENOENT") return null;
              throw e;
            });
          if (owner) {
            overrides.push({
              path: owner.path,
              version: owner.version,
              content: this.documents.owner(name, record),
            });
          }
        }
      }
      for (const record of Object.values(next)) {
        if (record.directory) record.directory = remap(record.directory, moves);
      }
      const file = await this.documents.file(),
        before = await fs.readFile(file, "utf8").catch(() => null);
      const history = await this.vault.history?.move(input.from, input.to);
      map.documents = next;
      const after = JSON.stringify(map, null, 2);
      return this.references.renameUnlocked(
        { ...input, moves, overrides, history },
        () => atomic(file, after),
        [{ name: "document_map.json", before, after }],
      );
    });
  }
  async journal() {
    return path.join(await this.references.directory(), "file-transaction.json");
  }
  async saveJournal(record) {
    await atomic(await this.journal(), JSON.stringify(record, null, 2));
  }
  async rollback(record) {
    for (const move of [...record.moves].reverse()) {
      const from = await this.vault.resolve(move.from, true),
        to = await this.vault.resolve(move.to, true),
        a = await fs.lstat(from).catch(() => null),
        b = await fs.lstat(to).catch(() => null);
      if (!a && b) {
        await fs.mkdir(path.dirname(from), { recursive: true });
        await fs.rename(to, from);
      } else if (a && b) throw fault("文件事务恢复遇到路径冲突。");
    }
    for (const edit of record.edits) {
      const disk = await snapshot(this.vault, edit.path);
      if (disk?.version === hash(edit.after)) {
        await replace(this.vault, edit.path, Buffer.from(edit.before), disk.version);
      } else if (disk?.version !== hash(edit.before)) {
        throw fault("文件事务恢复遇到外部修改：" + edit.path);
      }
    }
    for (const file of [...record.copies].reverse()) {
      const disk = await this.digest(file.path);
      if (!disk) continue;
      if (disk.version !== file.hash && disk.version !== file.beforeHash) {
        throw fault("复制文件已在外部修改：" + file.path);
      }
      await fs.unlink(await this.vault.resolve(file.path));
    }
    for (const folder of [...record.folders].reverse()) {
      await fs.rmdir(await this.vault.resolve(folder, true)).catch(e => {
        if (!["ENOENT", "ENOTEMPTY"].includes(e.code)) {
          throw e;
        }
      });
    }
    if(record.history)await this.vault.history.rollback(record.history);
    if (record.mapBefore !== undefined) {
      const file = await this.documents.file(),
        current = await fs.readFile(file, "utf8").catch(() => null);
      if (current !== record.mapBefore && current !== record.mapAfter) {
        throw fault("文档映射已在外部修改。");
      }
      if (record.mapBefore === null) {
        await fs.unlink(file).catch(e => {
          if (e.code !== "ENOENT") throw e;
        });
      } else await atomic(file, record.mapBefore);
    }
  }
  async recover() {
    const file = await this.journal();
    let record;
    try {
      record = JSON.parse(await fs.readFile(file, "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return;
      throw e;
    }
    if (
      record.phase === "complete"
      || record.phase === "ready-trash"
        && !await fs.lstat(await this.vault.resolve(record.stage, true)).catch(() => null)
    ) {
      if(record.history)await this.vault.history.finalize(record.history);
      await fs.unlink(file);
      return;
    }
    await this.rollback(record);
    await fs.unlink(file);
  }
  async transaction(action) {
    const file = await this.documents.file(),
      record = {
        phase: "working",
        moves: [],
        edits: [],
        copies: [],
        folders: [],
        mapBefore: await fs.readFile(file, "utf8").catch(() => null),
      };
    await this.saveJournal(record);
    let committed=false;
    try {
      const result = await action(record);
      record.phase = "complete";
      await this.saveJournal(record);
      await fs.unlink(await this.journal());committed=true;
      if(record.history)await this.vault.history.finalize(record.history).catch(()=>{});
      this.references.cache.clear();
      await this.references.refresh(await this.vault.list());
      return result;
    } catch (error) {
      if(committed)throw error;
      try {
        await this.rollback(record);
        await fs.unlink(await this.journal());
      } catch (recovery) {
        throw fault(error.message + "；" + recovery.message);
      }
      throw error;
    }
  }
  async mkdir(relative, record) {
    const missing = [];
    let current = relative;
    while (
      current && current !== "."
      && !await fs.lstat(await this.vault.resolve(current, true)).catch(() => null)
    ) {
      missing.unshift(current);
      current = path.posix.dirname(current);
    }
    for (const folder of missing) {
      record.folders.push(folder);
      await this.saveJournal(record);
      await fs.mkdir(await this.vault.resolve(folder, true));
    }
  }
  async copyFile(from, to, record) {
    if (!eligible(to)) throw fault("复制路径无效。");
    const source = await this.digest(from);
    if (!source) throw fault("文件不存在：" + from);
    const absolute = await this.vault.resolve(to, true);
    if (await fs.lstat(absolute).catch(() => null)) throw fault("目标文件已存在：" + to, "EEXIST");
    await this.mkdir(path.posix.dirname(to), record);
    record.copies.push({ path: to, hash: source.version });
    await this.saveJournal(record);
    await fs.copyFile(await this.vault.resolve(from), absolute, fs.constants.COPYFILE_EXCL);
    const copied = await this.digest(to);
    if (copied.version !== source.version) throw fault("复制期间源文件被修改。", "CONFLICT");
  }
  async copyTree(from, to, record) {
    const absolute = await this.vault.resolve(from), stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) throw fault("不复制符号链接。");
    if (stat.isFile()) return this.copyFile(from, to, record);
    if (await fs.lstat(await this.vault.resolve(to, true)).catch(() => null)) {
      throw fault("目标目录已存在：" + to, "EEXIST");
    }
    await this.mkdir(to, record);
    for (const entry of await fs.readdir(absolute)) {
      await this.copyTree(path.posix.join(from, entry), path.posix.join(to, entry), record);
    }
  }
  async copy(input) {
    return this.vault.mutate(async () => {
      if (
        !eligible(input.from) || !eligible(input.to) || inside(input.to, input.from)
        || inside(input.from, input.to)
      ) throw fault("复制路径无效。");
      const buffers = await this.buffers(input),
        map = await this.documents.read(),
        moves = [{ from: input.from, to: input.to }],
        sourceDocuments = Object.entries(map.documents).filter(([doc]) => inside(doc, input.from));
      this.structure(input.from, map);
      this.structure(input.to, map);
      for (const [document, record] of sourceDocuments) {
        if (record.directory && !inside(record.directory, input.from)) {
          moves.push({
            from: record.directory,
            to: this.documents.root(remap(document, moves)),
          });
        }
      }
      return this.transaction(async transaction => {
        for (const move of moves) await this.copyTree(move.from, move.to, transaction);
        const files = await this.inventory(), documents = [];
        for (
          const original of files.filter(f => /\.(md|markdown)$/i.test(f) && inside(f, input.from))
        ) {
          const destination = remap(original, moves),
            disk = await this.vault.read(destination),
            content = await rewrite(
              buffers.get(original)?.content ?? disk.content,
              original,
              moves,
              undefined,
              files,
            );
          if (content !== disk.content) {
            const copied = transaction.copies.find(f => f.path === destination);
            copied.beforeHash = copied.hash;
            copied.hash = hash(content);
            await this.saveJournal(transaction);
            await replace(this.vault, destination, Buffer.from(content), disk.version);
          }
          documents.push(await this.vault.read(destination));
        }
        for (const [document, record] of sourceDocuments) {
          const name = remap(document, moves);
          map.documents[name] = {
            ...structuredClone(record),
            ...(record.directory ? { directory: remap(record.directory, moves) } : {}),
          };
          const copiedDocument = documents.find(doc => doc.path === name);
          if (copiedDocument) {
            map.documents[name].blocks = await this.documents.blockIds(
              copiedDocument.content,
            );
          }
          if (record.directory) {
            const owner = path.posix.join(map.documents[name].directory, "document.json"),
              disk = await this.vault.read(owner),
              body = this.documents.owner(name, map.documents[name]),
              copy = transaction.copies.find(c => c.path === owner);
            copy.beforeHash = copy.hash;
            copy.hash = hash(body);
            await this.saveJournal(transaction);
            await replace(this.vault, owner, Buffer.from(body), disk.version);
          }
        }
        transaction.mapAfter = JSON.stringify(map, null, 2);
        await this.saveJournal(transaction);
        await atomic(await this.documents.file(), transaction.mapAfter);
        return { path: input.to, documents, buffers: [] };
      });
    });
  }
  async impact(input) {
    const map = await this.documents.read(), roots = [input.path];

    for (const [document, record] of Object.entries(map.documents)) {
      if (
        inside(document, input.path) && record.directory
        && !roots.some(r => inside(record.directory, r))
      ) roots.push(record.directory);
    }
    const files = await this.inventory(), buffers = await this.buffers(input), affected = [];
    for (
      const document of files.filter(f =>
        /\.(md|markdown)$/i.test(f) && !roots.some(r => inside(f, r))
      )
    ) {
      const disk = buffers.has(document) ? null : await readableNote(this.vault,document);
      if (!buffers.has(document) && !disk) continue;
      const content = buffers.get(document)?.content ?? disk.content,
        attachments = new Set();
      for (const node of await links(content)) {
        const target = await referencePath(document, node, files);
        if (
          target && Object.values(map.documents).some(r =>
            r.directory && roots.some(root =>
              inside(r.directory, root)
            )
            && inside(target, r.directory)
          ) && files.includes(target)
        ) attachments.add(target);
      }
      if (attachments.size) affected.push({ document, attachments: [...attachments] });
    }
    return { roots, affected };
  }
  async remove(input) {
    return this.vault.mutate(async () => {
      const impact = await this.impact(input),
        buffers = await this.buffers(input),
        map = await this.documents.read();
      return this.transaction(async record => {
        const documents = [], rewritten = [];
        if (input.transfer) {
          for (const affected of impact.affected) {
            const document = affected.document,
              owner = map.documents[document] ||= { nextId: 1, blocks: [] },
              directory = owner.directory || this.documents.root(document);
            if (
              !owner.directory
              && await fs.lstat(await this.vault.resolve(directory, true)).catch(() => null)
            ) throw fault("附属目录已存在：" + directory, "EEXIST");
            owner.directory = directory;
            owner.blocks = await this.documents.blockIds(
              (await this.vault.read(document)).content,
            );
            await this.mkdir(path.posix.join(directory, "attachments"), record);
            await this.mkdir(path.posix.join(directory, "code-data"), record);
            const ownerPath = path.posix.join(directory, "document.json");
            if (!await fs.lstat(await this.vault.resolve(ownerPath, true)).catch(() => null)) {
              const body = this.documents.owner(document, owner);
              record.copies.push({ path: ownerPath, hash: hash(body) });
              await this.saveJournal(record);
              await fs.writeFile(await this.vault.resolve(ownerPath, true), body, { flag: "wx" });
            }
            const moves = [];
            for (const attachment of affected.attachments) {
              const filename = path.posix.basename(attachment),
                ext = path.posix.extname(filename),
                stem = filename.slice(0, filename.length - ext.length);
              let to = path.posix.join(directory, "attachments", filename), i = 1;
              while (await fs.lstat(await this.vault.resolve(to, true)).catch(() => null)) {
                to = path.posix.join(directory, "attachments", stem + "-" + i++ + ext);
              }
              await this.copyFile(attachment, to, record);
              moves.push({ from: attachment, to });
            }
            const disk = await this.vault.read(document),
              after = await rewrite(disk.content, document, moves),
              buffer = buffers.get(document);
            if (after !== disk.content) {
              record.edits.push({ path: document, before: disk.content, after });
              await this.saveJournal(record);
              await replace(this.vault, document, Buffer.from(after), disk.version);
            }
            if (buffer) {
              rewritten.push({
                original: document,
                path: document,
                content: await rewrite(buffer.content, document, moves),
              });
            }
            documents.push(await this.vault.read(document));
          }
        }
        for (const document of Object.keys(map.documents)) {
          if (inside(document, input.path) || document === input.orphan) {
            delete map.documents[document];
          }
        }
        record.stage = "moyu-tmp-" + crypto.randomUUID();
        await this.mkdir(record.stage, record);
        for (const root of impact.roots) {
          if (!await fs.lstat(await this.vault.resolve(root, true)).catch(() => null)) continue;
          const to = path.posix.join(record.stage, isVaultData(root)
            ? '历史-' + crypto.randomUUID() + '/' + root.slice(DATA_FOLDER.length + 1) : root);
          await this.mkdir(path.posix.dirname(to), record);
          record.moves.push({ from: root, to });
          await this.saveJournal(record);
          await fs.rename(await this.vault.resolve(root), await this.vault.resolve(to, true));
        }
        record.mapAfter = JSON.stringify(map, null, 2);
        await this.saveJournal(record);
        await atomic(await this.documents.file(), record.mapAfter);
        const history=await this.vault.history?.move(input.path,input.path);if(history){record.history={...history,remove:true};await this.saveJournal(record);await this.vault.history.apply(record.history);}
        record.phase = "ready-trash";
        await this.saveJournal(record);
        await this.trashItem(await this.vault.resolve(record.stage));
        return { documents, buffers: rewritten, removed: impact.roots };
      });
    });
  }
  orphans() {
    return this.documents.orphans();
  }
  associate(input) {
    return this.vault.mutate(async () => {
      const orphan = (await this.orphans()).find(o => o.document === input.document);
      if (!orphan || !orphan.candidates.includes(input.target)) throw fault("请选择匹配的文档。");
      const map = await this.documents.read(),
        record = map.documents[input.document],
        next = this.documents.root(input.target),
        moves = record.directory === next ? [] : [{ from: record.directory, to: next }],
        disk = await this.vault.read(input.target),
        content = await rewrite(disk.content, input.document, [{
          from: input.document,
          to: input.target,
        }, ...moves]);
      delete map.documents[input.document];
      map.documents[input.target] = { ...record, directory: next };
      const file = await this.documents.file(),
        before = await fs.readFile(file, "utf8"),
        after = JSON.stringify(map, null, 2);
      return this.references.renameUnlocked(
        {
          moves,
          overrides: [
            { path: input.target, version: disk.version, content },
            ...(await this.vault.read(path.posix.join(orphan.directory, "document.json")).then(
              owner => [{
                path: owner.path,
                version: owner.version,
                content: this.documents.owner(input.target, record),
              }],
            ).catch(e => {
              if (e.code === "ENOENT") return [];
              throw e;
            })),
          ],
        },
        () => atomic(file, after),
        [{ name: "document_map.json", before, after }],
      );
    });
  }
}
module.exports = { DocumentFiles, inside, remap };
