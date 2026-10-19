const fs = require('node:fs/promises');
const path = require('node:path');
const PROGRAM = /^\d+\.\d+\.\d+-(?:64|32|ARM64)-[a-f\d]{16}$/;
const within = (parent, child) => {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return !relative || !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
};
async function stat(file) {
  try { return await fs.lstat(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
class EnvironmentCleanup {
  constructor({ root, legacy, program, vault, trash }) {
    this.root = path.resolve(root);
    this.legacy = path.resolve(legacy);
    this.program = path.resolve(program);
    this.vault = vault;
    this.trash = trash;
  }
  async entries() {
    const entries = [], base = path.join(this.root, 'programs');
    const directory = await stat(base);
    if (directory?.isDirectory() && !directory.isSymbolicLink()) {
      for (const item of await fs.readdir(base, { withFileTypes: true })) {
        if (!PROGRAM.test(item.name) || !item.isDirectory() || item.isSymbolicLink()) continue;
        const target = path.join(base, item.name);
        if (within(target, this.program)) continue;
        entries.push({ id: 'program-' + item.name, name: '程序环境 ' + item.name, path: target });
      }
    }
    const legacy = await stat(this.legacy);
    if (legacy?.isDirectory() && !legacy.isSymbolicLink()
      && !within(this.legacy, this.root) && !within(this.legacy, this.program)) {
      entries.push({ id: 'legacy-environment', name: '旧版应用数据', path: this.legacy });
    }
    const vault = this.vault();
    return entries.sort((a, b) => a.name.localeCompare(b.name)).map(item => ({
      ...item, blocked: !!vault && within(item.path, vault),
    }));
  }
  async remove(id) {
    const item = (await this.entries()).find(item => item.id === id);
    if (!item) throw Error('这个旧环境已不存在，或正在使用。');
    if (item.blocked) throw Error('当前知识库位于此目录，请先切换知识库。');
    // Revalidate the server-owned path immediately before trashing it. Never
    // accept a path from the renderer or follow a replaced directory symlink.
    const current = await stat(item.path);
    if (!current?.isDirectory() || current.isSymbolicLink()
      || within(item.path, this.root) || within(item.path, this.program)) throw Error('不能清理正在使用的目录。');
    if (item.id !== 'legacy-environment') {
      const base = path.join(this.root, 'programs');
      const baseStat = await stat(base);
      if (!baseStat?.isDirectory() || baseStat.isSymbolicLink()
        || path.dirname(item.path) !== base || !PROGRAM.test(path.basename(item.path))) throw Error('程序目录无效。');
    }
    await this.trash(item.path);
    return { message: '已移至回收站' };
  }
}
module.exports = { EnvironmentCleanup };
