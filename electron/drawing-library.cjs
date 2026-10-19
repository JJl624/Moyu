const fs = require("node:fs/promises"), path = require("node:path");
const { atomic, MAX } = require("./files.cjs"), { fault } = require("./vault.cjs");
const { DATA_FOLDER } = require("./vault-paths.cjs");
function parseLibrary(content) {
  if (typeof content !== "string" || Buffer.byteLength(content) > MAX) throw fault("素材库超过 20 MB。");
  let value;
  try { value = JSON.parse(content.replace(/^\uFEFF/, '')); } catch { throw fault("素材库格式无效。"); }
  const items = value?.version === 1 ? value.library || value.libraryItems : value?.libraryItems;
  if (value?.type !== "excalidrawlib" || ![1, 2].includes(value.version) || !Array.isArray(items) || items.length > 5000) throw fault("素材库格式无效。");
  let elements = 0;
  for (const item of items) {
    const scene = value.version === 1 ? item : item?.elements;
    if (!Array.isArray(scene) || scene.some(e => !e || typeof e !== "object" || typeof e.type !== "string") || (elements += scene.length) > 30000) throw fault("素材库格式无效或元素过多。");
  }
  return value;
}
class DrawingLibrary {
  constructor(vault) { this.vault = vault; }
  async file(create = false) {
    const root = path.join(this.vault.root, DATA_FOLDER);
    if (create) await fs.mkdir(root, { recursive: true });
    const directory = await fs.lstat(root).catch(e => { if (e.code === "ENOENT") return null; throw e; });
    if (directory && (!directory.isDirectory() || directory.isSymbolicLink())) throw fault("素材库目录无效。");
    const file = path.join(root, "excalidraw_library.excalidrawlib");
    if ((await fs.lstat(file).catch(e => { if (e.code === "ENOENT") return null; throw e; }))?.isSymbolicLink()) throw fault("素材库不能是符号链接。");
    return file;
  }
  async read() {
    const file = await this.file(), stat = await fs.stat(file).catch(e => { if (e.code === "ENOENT") return null; throw e; });
    if (!stat) return { root: this.vault.root, libraryItems: [] };
    if (stat.size > MAX || !stat.isFile()) throw fault("素材库文件无效或超过 20 MB。");
    const value = parseLibrary(await fs.readFile(file, "utf8"));
    // The persisted format is v2; v1 is accepted through Excalidraw's importer.
    if (value.version !== 2) throw fault("请通过打开素材库导入旧版文件。");
    return { root: this.vault.root, libraryItems: value.libraryItems };
  }
  save(items) {
    return this.vault.mutate(async () => {
      const content = JSON.stringify({ type: "excalidrawlib", version: 2, source: "Moyu", libraryItems: items }, null, 2);
      parseLibrary(content);
      const file = await this.file(true);
      if (await fs.readFile(file, "utf8").catch(e => { if (e.code === "ENOENT") return null; throw e; }) !== content) await atomic(file, content);
    });
  }
}
async function readLibraryFile(file) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > MAX) throw fault("素材库文件无效或超过 20 MB。");
  const content = await fs.readFile(file, "utf8");
  parseLibrary(content);
  return content;
}
module.exports = { DrawingLibrary, readLibraryFile, parseLibrary };
