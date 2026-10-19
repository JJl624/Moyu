const fs = require('node:fs/promises');
const path = require('node:path');

async function childPath(root, relative = '') {
  if (typeof relative !== 'string' || path.isAbsolute(relative)
    || relative.includes('\\') || relative.includes('\0')
    || relative.split('/').some(part => part === '..' || part === '.')) throw Error('数据路径无效。');
  const target = path.resolve(root, relative);
  if (target !== path.resolve(root) && !target.startsWith(path.resolve(root) + path.sep)) throw Error('数据路径无效。');
  let at = root;
  for (const part of ['', ...relative.split('/').filter(Boolean)]) {
    if (part) at = path.join(at, part);
    const stat = await fs.lstat(at);
    if (stat.isSymbolicLink()) throw Error('不能浏览链接目录。');
  }
  return target;
}
async function children(root, relative = '', offset = 0) {
  const target = await childPath(root, relative);
  const names = await fs.readdir(target, { withFileTypes: true });
  names.sort((a,b) => a.name.localeCompare(b.name, 'zh-CN', {numeric:true}));
  offset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  const items = names.slice(offset, offset + 100).map(entry => ({
    name: entry.name, relative: [relative, entry.name].filter(Boolean).join('/'),
    kind: entry.isSymbolicLink() ? 'link' : entry.isDirectory() ? 'directory' : 'file',
  }));
  return { items, next: offset + items.length < names.length ? offset + items.length : null };
}
module.exports = {childPath, children};
